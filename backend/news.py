"""Collect environmental headlines from the publisher's public RSS channels."""

import logging
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from http.client import HTTPException
from urllib.parse import urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from xml.etree import ElementTree

log = logging.getLogger(__name__)

FEEDS = (
    "https://dantri.com.vn/rss/thoi-su.rss",
    "https://dantri.com.vn/rss/khoa-hoc.rss",
)
TOPICS = {
    "waste": (
        "rac thai",
        "chat thai",
        "do trom rac",
        "tai che",
        "bai rac",
        "rac nhua",
        "phan huy sinh hoc",
    ),
    "water": (
        "nuoc thai",
        "ngap lut",
        "chong ngap",
        "nuoc sach",
        "o nhiem nuoc",
        "nao vet",
        "ung ngap",
    ),
    "air": (
        "khi thai",
        "khoi bui",
        "bui min",
        "o nhiem khong khi",
        "chat luong khong khi",
    ),
    "green": (
        "bao ve moi truong",
        "bien doi khi hau",
        "chong chiu khi hau",
        "cay xanh",
        "mang xanh",
        "da dang sinh hoc",
        "kinh te tuan hoan",
    ),
}
LIMIT_BYTES = 1024 * 1024
MAX_AGE = timedelta(days=60)
REFRESH_SECONDS = 30 * 60
_cached = {}


def _publisher_url(value):
    """Only keep direct HTTPS URLs on the publisher's host."""
    value = (value or "").strip()
    if "\\" in value or re.search(r"[\x00-\x20\x7f]", value):
        return None
    try:
        url = urlsplit(value)
        if (
            url.scheme != "https"
            or url.hostname not in {"dantri.com.vn", "www.dantri.com.vn"}
            or url.username is not None
            or url.password is not None
            or url.port not in {443, None}
        ):
            return None
    except ValueError:
        return None
    return urlunsplit(("https", "dantri.com.vn", url.path, "", ""))


class _PublisherRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if _publisher_url(newurl) is None:
            raise ValueError("RSS redirected to an unexpected host")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _text(value):
    return " ".join(re.sub(r"<[^<>]*>", " ", unescape(value or "")).split())


def _words(value):
    plain = unicodedata.normalize("NFD", value.casefold().replace("đ", "d"))
    return (
        " "
        + " ".join(
            re.findall(
                r"[a-z0-9]+",
                "".join(char for char in plain if not unicodedata.combining(char)),
            )
        )
        + " "
    )


def parse_feed(payload, *, now):
    if (
        len(payload) > LIMIT_BYTES
        or b"\x00" in payload
        or b"<!DOCTYPE" in payload.upper()
        or b"<!ENTITY" in payload.upper()
    ):
        raise ValueError("Invalid RSS payload")
    root = ElementTree.fromstring(payload)
    channel = root.find("channel")
    if channel is None:
        raise ValueError("Expected an RSS channel")
    rows = []
    for item in channel.findall("item")[:120]:
        title = _text(item.findtext("title"))
        link = _publisher_url(item.findtext("link"))
        keywords = _words(title)
        category = next(
            (
                name
                for name, terms in TOPICS.items()
                if any(f" {term} " in keywords for term in terms)
            ),
            None,
        )
        if not (title and link and category):
            continue
        try:
            published = parsedate_to_datetime(item.findtext("pubDate") or "")
            if not published.tzinfo:
                continue
            published = published.astimezone(timezone.utc)
        except (ValueError, TypeError, OverflowError):
            continue
        if not now - MAX_AGE <= published <= now + timedelta(hours=1):
            continue
        local = any(
            f" {term} " in keywords
            for term in (
                "tphcm",
                "tp hcm",
                "tp ho chi minh",
                "thanh pho ho chi minh",
                "o sai gon",
            )
        )
        words = title.split()
        headline = (
            title
            if len(words) <= 24 and len(title) <= 220
            else " ".join(words[:24])[:217].rstrip() + "…"
        )
        remaining = 24 - len(headline.split())
        description = re.sub(
            r"^\(Dân trí\)\s*[-–]\s*", "", _text(item.findtext("description"))
        ).split()
        excerpt = None
        if remaining >= 6 and len(description) >= 6:
            excerpt = " ".join(description[:remaining])
            if len(description) > remaining:
                excerpt = excerpt.rstrip(".,:;!?") + "…"
        rows.append(
            {
                "title": headline,
                "excerpt": excerpt,
                "source_url": link,
                "source_name": "Dân trí",
                "published_at": published,
                "category": category,
                "area": "TP. Hồ Chí Minh" if local else None,
            }
        )
    return rows


def articles():
    cutoff = datetime.now(timezone.utc) - MAX_AGE
    items = {
        item["source_url"]: item
        for rows in _cached.values()
        for item in rows
        if item["published_at"] >= cutoff
    }
    return sorted(
        items.values(),
        key=lambda item: (bool(item["area"]), item["published_at"]),
        reverse=True,
    )[:24]


def refresh():
    global _cached
    opener = build_opener(_PublisherRedirect())
    updated = _cached.copy()
    for url in FEEDS:
        request = Request(
            url,
            headers={
                "User-Agent": "PhanAnhXanh/1.0 (environmental RSS reader)",
                "Accept": "application/rss+xml, application/xml, text/xml",
            },
        )
        try:
            with opener.open(request, timeout=7) as response:
                raw = response.read(LIMIT_BYTES + 1)
            updated[url] = parse_feed(raw, now=datetime.now(timezone.utc))
        except (OSError, HTTPException, ValueError, ElementTree.ParseError) as exc:
            log.warning("News feed unavailable (%s): %s", type(exc).__name__, url)
    _cached = updated


def run(stop):
    while not stop.is_set():
        refresh()
        if stop.wait(REFRESH_SECONDS):
            break
