import asyncio
import json
import os
from datetime import datetime
from urllib.parse import urlparse

import httpx

TAVILY_KEY = os.getenv("TAVILY_API_KEY", "")
GEMINI_KEY = os.getenv("GEMINI_API_KEY", "")

FALLBACK_KEYWORDS = [
    "breaking news today",
    "India news today",
    "world politics today",
    "technology news today",
    "football transfer news",
    "cricket news today",
    "stock market news today",
    "science discovery today",
    "health news today",
    "entertainment news today",
    "climate news today",
    "Middle East news today",
    "UK politics today",
    "US politics today",
    "economy news today",
]


async def generate_keywords() -> list[str]:
    if not GEMINI_KEY:
        return FALLBACK_KEYWORDS

    prompt = """You are a news editor. Generate 15 diverse search queries to find
the most important breaking news RIGHT NOW across:
World Politics, India, Economy, Technology, Football, Cricket,
Entertainment, Science, Health, Climate.

Rules:
- Make queries specific not generic ('India budget 2025' not 'India news')
- Mix global and regional topics
- Return ONLY a raw JSON array of strings, no markdown, no explanation

Example: ['query one', 'query two']"""

    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
                params={"key": GEMINI_KEY},
                json={"contents": [{"parts": [{"text": prompt}]}]},
                timeout=15,
            )
            res.raise_for_status()
            text = res.json()["candidates"][0]["content"]["parts"][0]["text"]
            cleaned = (
                text.removeprefix("```json")
                .removeprefix("```")
                .removesuffix("```")
                .strip()
            )
            return json.loads(cleaned)
    except Exception as e:
        print(f"[Agent] generate_keywords error: {e}")
        return FALLBACK_KEYWORDS


async def search_keyword(keyword: str) -> list[dict]:
    if not TAVILY_KEY:
        return []

    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": TAVILY_KEY,
                    "query": keyword,
                    "search_depth": "basic",
                    "max_results": 5,
                    "include_answer": False,
                    "include_raw_content": False,
                    "exclude_domains": [
                        "reddit.com",
                        "quora.com",
                        "pinterest.com",
                    ],
                },
                timeout=15,
            )
            res.raise_for_status()
            return res.json().get("results", [])
    except Exception as e:
        print(f"[Agent] search_keyword error for '{keyword}': {e}")
        return []


def _extract_domain(url: str) -> str:
    try:
        netloc = urlparse(url).netloc
        netloc = netloc.removeprefix("www.")
        parts = netloc.split(".")
        if not parts:
            return "Web"
        parts[0] = parts[0].capitalize()
        return ".".join(parts)
    except Exception:
        return "Web"


async def run_agent():
    import database
    import classifier

    keywords = await generate_keywords()
    saved = 0
    skipped = 0

    for keyword in keywords:
        results = await search_keyword(keyword)
        for r in results:
            url = r.get("url", "").strip()
            title = r.get("title", "").strip()
            body = r.get("content", "")
            if not url or not title:
                continue
            if database.url_exists(url):
                skipped += 1
                continue
            try:
                classification = classifier.classify(title, _extract_domain(url))
            except Exception as e:
                print(f"[Agent] classify error: {e}")
                continue

            database.insert_article(
                {
                    "title": title,
                    "url": url,
                    "source": _extract_domain(url),
                    "published_at": r.get("published_date"),
                    "fetched_at": datetime.utcnow().isoformat(),
                    "summary": body[:300] if body else None,
                    "lean": classification.get("lean", "Unclear"),
                    "lean_confidence": classification.get("lean_confidence", 0),
                    "genre": classification.get("genre", "Other"),
                    "subgenre": classification.get("subgenre", "Other"),
                    "is_rumour": 1 if classification.get("is_rumour") else 0,
                    "rumour_true_probability": classification.get(
                        "rumour_true_probability", 50
                    ),
                    "rumour_false_probability": classification.get(
                        "rumour_false_probability", 50
                    ),
                    "rumour_verdict": classification.get(
                        "rumour_verdict", "Unverified"
                    ),
                    "is_breaking": 1 if classification.get("is_breaking") else 0,
                    "is_transfer": 1 if classification.get("is_transfer") else 0,
                    "transfer_player": classification.get("transfer_player"),
                    "transfer_from": classification.get("transfer_from"),
                    "transfer_to": classification.get("transfer_to"),
                    "transfer_fee": classification.get("transfer_fee"),
                    "image_keyword": keyword,
                    "ingestion_source": "agent",
                }
            )
            saved += 1
        await asyncio.sleep(0.5)

    print(f"[Agent] Cycle done — saved {saved}, skipped {skipped} dupes")
