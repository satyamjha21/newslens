import json
import os
import re

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


def classify(headline: str, source: str) -> dict:
    if not _api_key:
        result = dict(DEFAULT_RESULT)
        result["summary"] = headline[:200]
        return result

    prompt = (
        f'{SYSTEM_PROMPT}\n\nHeadline: "{headline}"\nSource: "{source}"'
    )

    try:
        import google.generativeai as genai

        model = genai.GenerativeModel("gemini-1.5-flash")
        response = model.generate_content(prompt)
        cleaned = strip_markdown(response.text)
        match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if not match:
            raise ValueError("No JSON object found")
        data = json.loads(match.group())

        result = dict(DEFAULT_RESULT)
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
        return result
    except Exception as e:
        print(f"[Classifier] Error: {e}")
        result = dict(DEFAULT_RESULT)
        result["summary"] = headline[:200]
        return result
