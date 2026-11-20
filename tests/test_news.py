import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from backend import news


class EnvironmentNewsTests(unittest.TestCase):
    def test_parse_filters_invalid_and_outdated_items(self):
        xml = """
        <rss version="2.0"><channel>
          <item><title><![CDATA[Camera &amp; xử lý đổ trộm rác ở TP.HCM]]></title>
          <link>https://dantri.com.vn/thoi-su/camera.htm?utm_source=rss</link>
          <pubDate>Fri, 20 Nov 2026 11:46:18 +0700</pubDate>
          <description><![CDATA[<b>Body stays outside API.</b>]]></description></item>
          <item><title>Hội nghị công tác của Sở Nông nghiệp và Môi trường</title>
          <link>https://dantri.com.vn/thoi-su/cong-tac.htm</link>
          <pubDate>Fri, 20 Nov 2026 09:00:00 +0700</pubDate></item>
          <item><title>Vệ sinh và tái chế rác thải</title>
          <link>https://malicious.example/dantri.com.vn</link>
          <pubDate>Fri, 20 Nov 2026 09:00:00 +0700</pubDate></item>
          <item><title>Kiểm tra xử lý nước thải</title>
          <link>https://dantri.com.vn/thoi-su/old.htm</link>
          <pubDate>Thu, 20 Aug 2026 09:00:00 +0700</pubDate></item>
        </channel></rss>
        """.encode()
        rows = news.parse_feed(xml, now=datetime(2026, 11, 20, 7, tzinfo=timezone.utc))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["title"], "Camera & xử lý đổ trộm rác ở TP.HCM")
        self.assertEqual(rows[0]["category"], "waste")
        self.assertEqual(rows[0]["area"], "TP. Hồ Chí Minh")
        self.assertEqual(
            rows[0]["source_url"], "https://dantri.com.vn/thoi-su/camera.htm"
        )
        self.assertNotIn("description", rows[0])

    def test_rejects_dtd_and_unexpected_redirects(self):
        with self.assertRaises(ValueError):
            news.parse_feed(b"<!DOCTYPE rss><rss />", now=datetime.now(timezone.utc))
        with self.assertRaises(ValueError):
            news._PublisherRedirect().redirect_request(
                None, None, 302, "", {}, "https://example.com/feed"
            )

    def test_excerpt_budget_includes_headline(self):
        xml = """
        <rss><channel><item>
          <title>Thành phố thử phân loại rác thải tại nguồn</title>
          <link>https://dantri.com.vn/thoi-su/phan-loai.htm</link>
          <pubDate>Fri, 20 Nov 2026 11:46:18 +0700</pubDate>
          <description><![CDATA[<img src="https://example.com/photo.jpg" /> (Dân trí) -
            Người dân được hướng dẫn tách riêng rác tái chế và rác hữu cơ tại nhà trước
            khi đem ra điểm tập kết theo lịch thu gom của khu phố.]]></description>
        </item></channel></rss>
        """.encode()
        [item] = news.parse_feed(
            xml, now=datetime(2026, 11, 20, 7, tzinfo=timezone.utc)
        )
        self.assertTrue(item["excerpt"].startswith("Người dân"))
        self.assertTrue(item["excerpt"].endswith("…"))
        self.assertNotIn("<", item["excerpt"])
        self.assertLessEqual(
            len(item["title"].split()) + len(item["excerpt"].split()), 24
        )

    def test_deduplicates_and_prioritizes_local_titles(self):
        now = datetime.now(timezone.utc)
        local = {
            "source_url": "https://dantri.com.vn/local",
            "area": "TP.HCM",
            "published_at": now,
        }
        general = {
            "source_url": "https://dantri.com.vn/elsewhere",
            "area": None,
            "published_at": now,
        }
        with patch.object(
            news, "_cached", {"first": [general, local], "second": [general]}
        ):
            self.assertEqual(news.articles(), [local, general])
