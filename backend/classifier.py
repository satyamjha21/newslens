import json
import logging
import os
import re
from typing import List

logger = logging.getLogger("newslens")

DEFAULT_RESULT = {
    "lean": "Unclear",
    "lean_confidence": 0,
    "genre": "Other",
    "subgenre": "Other",
    "is_rumour": False,
    "rumour_true_probability": 50,
    "rumour_false_probability": 50,
    "rumour_verdict": "Unverified",
    "is_breaking": False,
    "is_transfer": False,
    "transfer_player": None,
    "transfer_from": None,
    "transfer_to": None,
    "transfer_fee": None,
    "summary": "",
    "image_keyword": "news article",
}

GEMINI_MODEL = "gemini-1.5-flash"
BATCH_SIZE = 5

SYSTEM_PROMPT = """You are a professional news analyst AI. Given a news headline and
source, return ONLY a valid JSON object — no markdown, no explanation,
just raw JSON.

Classify the following fields:

{
  "lean": "Left" | "Centre" | "Right" | "Unclear",
  "lean_confidence": 0-100,
  "genre": "World Politics" | "India" | "US Politics" | "Middle East" |
           "Europe" | "Economy" | "Technology" | "Science" | "Health" |
           "Climate" | "Entertainment" | "Music" | "Cinema" | "Football" |
           "Cricket" | "Formula 1" | "Tennis" | "NBA" | "Boxing" |
           "Other Sports",
  "subgenre": "Premier League" | "La Liga" | "Serie A" | "Bundesliga" |
              "Ligue 1" | "Champions League" | "Europa League" |
              "International Football" | "Transfer" | "Manager" |
              "IPL" | "Test Cricket" | "Album" | "Tour" | "Film Release" |
              "Awards" | "Box Office" | "Celebrity" | "Other",
  "is_rumour": true | false,
  "rumour_true_probability": 0-100,
  "rumour_false_probability": 0-100,
  "rumour_verdict": "Confirmed" | "Likely True" | "Unverified" |
                    "Likely False" | "Debunked",
  "is_breaking": true | false,
  "is_transfer": true | false,
  "transfer_player": "player or manager name or null",
  "transfer_from": "club name or null",
  "transfer_to": "club name or null",
  "transfer_fee": "estimated fee or null",
  "summary": "One sentence summary in plain English.",
  "image_keyword": "3 word search term for a relevant image"
}

Rules:
- is_rumour true if headline contains: rumour, linked, could, set to,
  eyeing, in talks, considering, reportedly, sources claim, according to,
  shock move, surprise interest
- is_breaking only for genuine breaking news: disasters, election results,
  major confirmed policy changes, confirmed signings
- lean reflects the political framing of headline + source.
  Sports, tech, science → Unclear unless clearly politicised.
- For football transfers: always populate transfer fields if detectable.
- For music: flag unconfirmed album drops, tour announcements, collaborations.
- For cinema: flag unconfirmed casting, sequel rumours, release speculation."""

BATCH_SYSTEM_PROMPT = """You are a professional news analyst AI. Classify each article below.
Return ONLY a valid JSON array with one classification object per article, in the same order.
No markdown, no explanation — just the raw JSON array.

Each object must include these fields:
{
  "lean": "Left" | "Centre" | "Right" | "Unclear",
  "lean_confidence": 0-100,
  "genre": "World Politics" | "India" | "US Politics" | "Middle East" |
           "Europe" | "Economy" | "Technology" | "Science" | "Health" |
           "Climate" | "Entertainment" | "Music" | "Cinema" | "Football" |
           "Cricket" | "Formula 1" | "Tennis" | "NBA" | "Boxing" | "Other Sports",
  "subgenre": string,
  "is_rumour": true | false,
  "rumour_true_probability": 0-100,
  "rumour_false_probability": 0-100,
  "rumour_verdict": "Confirmed" | "Likely True" | "Unverified" | "Likely False" | "Debunked",
  "is_breaking": true | false,
  "is_transfer": true | false,
  "transfer_player": string or null,
  "transfer_from": string or null,
  "transfer_to": string or null,
  "transfer_fee": string or null,
  "summary": "One sentence summary.",
  "image_keyword": "3 word search term"
}

Apply the same classification rules as for single-article analysis."""

_api_key = os.getenv("GEMINI_API_KEY", "")
if _api_key:
    try:
        import google.generativeai as genai

        genai.configure(api_key=_api_key)
    except Exception:
        pass


def strip_markdown(text: str) -> str:
    return re.sub(r"```(?:json)?", "", text).strip()


def _clamp_int(value, default):
    try:
        return max(0, min(100, int(value)))
    except (TypeError, ValueError):
        return default


def normalize_result(data: dict, fallback_title: str = "") -> dict:
    result = dict(DEFAULT_RESULT)
    if data:
        result.update(data)

    for key in ("is_rumour", "is_breaking", "is_transfer"):
        val = result.get(key)
        if isinstance(val, str):
            result[key] = val.lower() == "true"
        else:
            result[key] = bool(val)

    result["lean_confidence"] = _clamp_int(
        result.get("lean_confidence"), DEFAULT_RESULT["lean_confidence"]
    )
    result["rumour_true_probability"] = _clamp_int(
        result.get("rumour_true_probability"),
        DEFAULT_RESULT["rumour_true_probability"],
    )
    result["rumour_false_probability"] = _clamp_int(
        result.get("rumour_false_probability"),
        DEFAULT_RESULT["rumour_false_probability"],
    )
    if not result.get("summary") and fallback_title:
        result["summary"] = fallback_title[:200]
    return result


def _parse_json_object(text: str) -> dict:
    cleaned = strip_markdown(text)
    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if not match:
        raise ValueError("No JSON object found")
    return json.loads(match.group())


def _parse_json_array(text: str) -> list:
    cleaned = strip_markdown(text)
    match = re.search(r"\[.*\]", cleaned, re.DOTALL)
    if not match:
        raise ValueError("No JSON array found")
    return json.loads(match.group())


def classify(headline: str, source: str) -> dict:
    if not _api_key:
        result = dict(DEFAULT_RESULT)
        result["summary"] = headline[:200]
        return result

    prompt = f'{SYSTEM_PROMPT}\n\nHeadline: "{headline}"\nSource: "{source}"'

    try:
        import google.generativeai as genai

        model = genai.GenerativeModel(GEMINI_MODEL)
        response = model.generate_content(prompt)
        data = _parse_json_object(response.text)
        return normalize_result(data, headline)
    except Exception as exc:
        logger.warning("Classifier error: %s", exc)
        result = dict(DEFAULT_RESULT)
        result["summary"] = headline[:200]
        return result


def batch_classify(articles: List[dict]) -> List[dict]:
    """Classify up to BATCH_SIZE articles in one Gemini call; falls back per-article."""
    if not articles:
        return []

    if not _api_key:
        return [
            normalize_result(dict(DEFAULT_RESULT), a.get("title", "")) for a in articles
        ]

    lines = []
    for idx, article in enumerate(articles, start=1):
        title = article.get("title", "")
        source = article.get("source", "")
        lines.append(f'{idx}. Title: "{title}"\n   Source: "{source}"')

    prompt = (
        f"{BATCH_SYSTEM_PROMPT}\n\nArticles:\n\n"
        + "\n\n".join(lines)
        + f"\n\nReturn exactly {len(articles)} objects in a JSON array."
    )

    try:
        import google.generativeai as genai

        model = genai.GenerativeModel(GEMINI_MODEL)
        response = model.generate_content(prompt)
        data = _parse_json_array(response.text)
        if len(data) != len(articles):
            raise ValueError(
                f"Expected {len(articles)} results, got {len(data)}"
            )
        return [
            normalize_result(item, articles[i].get("title", ""))
            for i, item in enumerate(data)
        ]
    except Exception as exc:
        logger.warning("Batch classify failed, falling back to single: %s", exc)
        return [classify(a.get("title", ""), a.get("source", "")) for a in articles]


def classify_with_cache(article: dict, fast_classify_fn) -> dict:
    """Return cached, Gemini, or rule-based classification for one article."""
    import database

    url = article.get("url", "")
    if url:
        cached = database.get_cached_classification(url)
        if cached:
            return cached

    if _api_key:
        result = classify(article.get("title", ""), article.get("source", ""))
    else:
        result = fast_classify_fn(article.get("title", ""), article.get("source", ""))

    if url:
        database.cache_classification(url, result)
    return result


def batch_classify_with_cache(
    articles: List[dict], fast_classify_fn
) -> List[dict]:
    """Classify a batch, using cache where available."""
    import database

    results: List[dict] = []
    uncached: List[dict] = []
    uncached_indices: List[int] = []

    for idx, article in enumerate(articles):
        url = article.get("url", "")
        cached = database.get_cached_classification(url) if url else None
        if cached:
            results.append(cached)
        else:
            results.append(None)
            uncached.append(article)
            uncached_indices.append(idx)

    if uncached:
        if _api_key:
            classified = batch_classify(uncached)
        else:
            classified = [
                fast_classify_fn(a.get("title", ""), a.get("source", ""))
                for a in uncached
            ]

        for idx, article, classification in zip(
            uncached_indices, uncached, classified
        ):
            url = article.get("url", "")
            if url:
                database.cache_classification(url, classification)
            results[idx] = classification

    return results
