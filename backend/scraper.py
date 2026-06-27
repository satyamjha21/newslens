import socket
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from email.utils import parsedate_to_datetime
from typing import Dict, List

import feedparser

socket.setdefaulttimeout(8)
FEED_ENTRIES_LIMIT = 8

FEEDS = [
    ("BBC World", "http://feeds.bbci.co.uk/news/world/rss.xml"),
    ("Reuters", "https://feeds.reuters.com/reuters/topNews"),
    ("Al Jazeera", "https://www.aljazeera.com/xml/rss/all.xml"),
    ("Guardian World", "https://www.theguardian.com/world/rss"),
    ("Fox News", "https://feeds.foxnews.com/foxnews/latest"),
    ("NPR News", "https://feeds.npr.org/1001/rss.xml"),
    ("NDTV", "https://feeds.feedburner.com/ndtvnews-top-stories"),
    ("The Hindu", "https://www.thehindu.com/news/feeder/default.rss"),
    ("Times of India", "https://timesofindia.indiatimes.com/rssfeedstopstories.cms"),
    ("Indian Express", "https://indianexpress.com/feed/"),
    ("Financial Times", "https://www.ft.com/rss/home"),
    ("Bloomberg", "https://feeds.bloomberg.com/markets/news.rss"),
    ("Mint", "https://www.livemint.com/rss/news"),
    ("TechCrunch", "https://techcrunch.com/feed/"),
    ("The Verge", "https://www.theverge.com/rss/index.xml"),
    ("Wired", "https://www.wired.com/feed/rss"),
    ("Ars Technica", "https://feeds.arstechnica.com/arstechnica/index"),
    ("Science Daily", "https://www.sciencedaily.com/rss/top.xml"),
    ("New Scientist", "https://www.newscientist.com/feed/home"),
    ("WHO", "https://www.who.int/rss-feeds/news-english.xml"),
    ("WebMD", "https://rssfeeds.webmd.com/rss/rss.aspx?RSSSource=RSS_PUBLIC"),
    ("Rolling Stone", "https://www.rollingstone.com/feed/"),
    ("Pitchfork", "https://pitchfork.com/rss/news/"),
    ("NME", "https://www.nme.com/feed"),
    ("Variety", "https://variety.com/feed/"),
    ("Deadline Hollywood", "https://deadline.com/feed/"),
    ("The Hollywood Reporter", "https://www.hollywoodreporter.com/feed/"),
    ("Sky Sports Football", "https://www.skysports.com/rss/12040"),
    ("BBC Sport Football", "http://feeds.bbci.co.uk/sport/football/rss.xml"),
    ("ESPN FC", "https://www.espn.com/espn/rss/soccer/news"),
    ("Goal.com", "https://www.goal.com/feeds/en/news"),
    ("The Athletic Football", "https://theathletic.com/rss-feeds/"),
    ("Fabrizio Romano", "https://rsshub.app/twitter/user/FabrizioRomano"),
    ("BBC Sport", "http://feeds.bbci.co.uk/sport/rss.xml"),
    ("ESPN", "https://www.espn.com/espn/rss/news"),
    ("Cricinfo", "http://static.cricinfo.com/rss/livescores.xml"),
    ("F1 Official", "https://www.formula1.com/content/fom-website/en/latest/all.rss"),
    ("Tennis World", "https://www.tennisworldusa.org/feed/"),
    ("NBA", "https://www.nba.com/rss/nba_rss.xml"),
]


def parse_date(entry) -> str:
    for attr in ("published", "updated"):
        raw = getattr(entry, attr, None)
        if raw:
            try:
                return parsedate_to_datetime(raw).isoformat()
            except Exception:
                continue
    return datetime.utcnow().isoformat()


def fetch_feed(url: str, source_name: str) -> List[Dict]:
    try:
        feed = feedparser.parse(url)
        if feed.bozo and not feed.entries:
            print(f"[RSS] Warning: no entries from {source_name}")
            return []

        seen_urls = set()
        articles = []
        for entry in feed.entries[:FEED_ENTRIES_LIMIT]:
            link = getattr(entry, "link", None)
            title = getattr(entry, "title", None)
            if not link or not title:
                continue
            if link in seen_urls:
                continue
            seen_urls.add(link)
            articles.append(
                {
                    "title": title.strip(),
                    "url": link.strip(),
                    "published_at": parse_date(entry),
                    "source": source_name,
                }
            )
        return articles
    except Exception as e:
        print(f"[RSS] Error fetching {source_name}: {e}")
        return []


def fetch_all_feeds(max_workers: int = 12) -> List[Dict]:
    seen = set()
    all_articles = []

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {
            pool.submit(fetch_feed, url, name): name for name, url in FEEDS
        }
        for future in as_completed(futures):
            source_name = futures[future]
            try:
                for article in future.result():
                    if article["url"] not in seen:
                        seen.add(article["url"])
                        all_articles.append(article)
            except Exception as e:
                print(f"[RSS] Feed failed {source_name}: {e}", flush=True)

    print(f"[RSS] Fetched {len(all_articles)} articles from {len(FEEDS)} feeds", flush=True)
    return all_articles
