import json
import os
import unittest
from io import BytesIO
from pathlib import Path
from unittest import mock

from PIL import Image

from backend import admin_ai, classifier, vision


def photo():
    out = BytesIO()
    Image.new("RGB", (2000, 1500), (90, 90, 90)).save(out, format="WEBP")
    return out.getvalue()


class Reply:
    def __init__(self, content):
        self.body = json.dumps({"choices": [{"message": {"content": content}}]}).encode()

    def __enter__(self):
        return BytesIO(self.body)

    def __exit__(self, *args):
        return False


GOOD = '{"group":"water","urgent":true,"confidence":0.9,"summary":"Kênh nước đen."}'


class VisionTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, {"DEPLOY_API_KEY": "test-key"})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_parse_accepts_fenced_json(self):
        result = vision.parse("```json\n" + GOOD + "\n```")
        self.assertEqual(result["group"], "water")
        self.assertTrue(result["urgent"])

    def test_parse_rejects_bad_group_and_text(self):
        for bad in ('{"group":"fire","urgent":false}', "xin chào", '{"group":"waste"}'):
            with self.assertRaises(ValueError):
                vision.parse(bad)

    def test_request_shape(self):
        with mock.patch("urllib.request.urlopen", return_value=Reply(GOOD)) as call:
            vision.analyze("Nước kênh đen", [photo()])
        request = call.call_args.args[0]
        self.assertEqual(
            request.full_url, "https://api-cdn.deploy.com/api/v1/chat/completions"
        )
        self.assertEqual(request.get_header("Authorization"), "Bearer test-key")
        body = json.loads(request.data)
        self.assertEqual(body["model"], "deepseek-ai/deepseek-v4.1-flash-1017")
        url = body["messages"][1]["content"][1]["image_url"]["url"]
        self.assertTrue(url.startswith("data:image/jpeg;base64,"))

    def test_uses_deepseek_when_consented(self):
        with mock.patch("urllib.request.urlopen", return_value=Reply(GOOD)):
            result = classifier.analyze("Nước kênh đen", [photo()], True)
        self.assertEqual(result["source"], "deepseek")
        self.assertEqual(result["group"], "water")

    def test_no_external_call_without_consent_or_photos(self):
        with mock.patch("urllib.request.urlopen") as call:
            self.assertEqual(classifier.analyze("rác", [photo()], False)["source"], "clip")
            self.assertEqual(classifier.analyze("rác thải", [], True)["source"], "clip")
        call.assert_not_called()

    def test_falls_back_to_clip_on_failure(self):
        with mock.patch("urllib.request.urlopen", return_value=Reply("không phải JSON")):
            result = classifier.analyze("rác thải sinh hoạt", [photo()], True)
        self.assertEqual(result["source"], "clip")
        self.assertIsNone(result["summary"])

    def test_skips_deepseek_when_local_model_is_confident(self):
        waste = Path("public/images/waste.webp").read_bytes()
        with mock.patch("urllib.request.urlopen") as call:
            result = classifier.analyze(
                "Rác thải sinh hoạt chất đống trên vỉa hè", [waste], True
            )
        call.assert_not_called()
        self.assertEqual(result["source"], "clip")
        self.assertEqual(result["group"], "waste")

    def test_unrelated_low_confidence_photo_without_consent_returns_other(self):
        result = classifier.analyze("đasdsadsad", [photo()], False)
        self.assertEqual(result["source"], "clip")
        self.assertEqual(result["group"], "other")
        self.assertTrue(result["rejected"])

    def test_rejects_unrelated_photo_from_deepseek(self):
        irrelevant = (
            '{"relevant":false,"group":"other","urgent":false,'
            '"confidence":0.99,"summary":"Ảnh nhân vật hoạt hình, không liên quan môi trường."}'
        )
        with mock.patch("urllib.request.urlopen", return_value=Reply(irrelevant)):
            result = classifier.analyze("ô nhiễm nước", [photo()], True)
        self.assertTrue(result["rejected"])
        self.assertFalse(result["urgent"])
        self.assertEqual(result["group"], "other")
        self.assertEqual(result["source"], "deepseek")

    def test_admin_ai_urgency_and_local_assist(self):
        report = {
            "id": "PX-TEST1",
            "ai_group": "hazard",
            "urgent": True,
            "priority": "normal",
            "assignee": None,
            "ward": "Phường Sài Gòn, Thành phố Hồ Chí Minh",
            "location": "Đường Nguyễn Huệ",
            "description": "Rò rỉ hóa chất bốc mùi khét.",
            "status": "received",
        }
        score = admin_ai.urgency_score(
            report, {"Phường Sài Gòn, Thành phố Hồ Chí Minh": 3}
        )
        self.assertGreaterEqual(score, 80)
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("DEPLOY_API_KEY", None)
            local = admin_ai.assist(report)
        self.assertEqual(local["source"], "local")
        self.assertEqual(local["confirmed_group"], "hazard")
        self.assertEqual(local["priority"], "high")
        self.assertTrue(len(local["action_steps"]) >= 3)
        self.assertIn("PX-TEST1", local["draft_note"])

    def test_admin_ai_assist_uses_deepseek_and_briefing(self):
        reply = json.dumps(
            {
                "confirmed_group": "flood",
                "priority": "high",
                "action_steps": ["Khơi thông hố ga", "Đặt biển cảnh báo"],
                "draft_note": "Đã tiếp nhận sự cố ngập úng và cử đội thoát nước xử lý.",
            }
        )
        report = {
            "id": "PX-TEST2",
            "ai_group": "flood",
            "description": "Ngập sâu trước hẻm.",
            "location": "Quận 1",
            "status": "received",
        }
        with mock.patch("urllib.request.urlopen", return_value=Reply(reply)):
            res = admin_ai.assist(report)
        self.assertEqual(res["source"], "deepseek")
        self.assertEqual(res["confirmed_group"], "flood")
        self.assertEqual(res["priority"], "high")

        brief_reply = json.dumps({"recommendations": ["Ưu tiên điểm ngập Bình Thạnh."]})
        staff = [
            {"id": 1, "name": "Cán bộ A", "active": True},
            {"id": 2, "name": "Cán bộ B", "active": True},
        ]
        reports = [
            {**report, "assignee": 1, "ward": "Phường Bình Thạnh, Thành phố Hồ Chí Minh"},
            {**report, "id": "PX-TEST3", "assignee": None, "status": "rejected"},
        ]
        with mock.patch("urllib.request.urlopen", return_value=Reply(brief_reply)):
            b = admin_ai.briefing(reports, staff, use_deepseek=True)
        self.assertEqual(b["source"], "deepseek")
        self.assertEqual(b["recommended_staff"]["id"], 2)
        self.assertEqual(b["rejected_count"], 1)

    def test_citizen_advice_recommends_114_for_fire_and_1022_for_flood(self):
        fire = admin_ai.citizen_advice(
            {
                "status": "received",
                "ai_state": "done",
                "ai_group": "hazard",
                "title": "Cháy bãi rác kèm rò rỉ gas gần nhà dân",
                "summary": "Khói đen bốc cao và có tiếng nổ nhỏ",
                "urgent": True,
            }
        )
        self.assertIsNotNone(fire)
        self.assertEqual(fire["level"], "emergency")
        self.assertIn("114", [h["number"] for h in fire["hotlines"]])
        self.assertEqual(len(fire["tips"]), 3)

        chemical_med = admin_ai.citizen_advice(
            {
                "status": "received",
                "ai_state": "done",
                "ai_group": "hazard",
                "title": "Rò rỉ hóa chất làm nhiều người khó thở",
                "summary": "Mùi hắc nồng nặc quanh kho",
                "urgent": True,
            }
        )
        nums = [h["number"] for h in chemical_med["hotlines"]]
        self.assertIn("114", nums)
        self.assertIn("115", nums)

        tree_power = admin_ai.citizen_advice(
            {
                "status": "received",
                "ai_state": "done",
                "ai_group": "tree",
                "title": "Cây xanh bật gốc ngã đè dây điện",
                "summary": "Chắn ngang đường",
                "urgent": True,
            }
        )
        tree_nums = [h["number"] for h in tree_power["hotlines"]]
        self.assertEqual(tree_nums, ["1022", "1900 545454", "114"])

        flood = admin_ai.citizen_advice(
            {
                "status": "received",
                "ai_state": "done",
                "ai_group": "flood",
                "title": "Ngập sâu sau mưa lớn",
                "summary": "Nước dâng nửa bánh xe",
                "urgent": False,
            }
        )
        self.assertIn("1022", [h["number"] for h in flood["hotlines"]])

        noise = admin_ai.citizen_advice(
            {
                "status": "received",
                "ai_state": "done",
                "ai_group": "noise",
                "title": "Loa kéo mở khuya",
                "summary": "Ồn ào sau 22h",
                "urgent": False,
            }
        )
        self.assertIn("113", [h["number"] for h in noise["hotlines"]])

        pending = admin_ai.citizen_advice(
            {
                "status": "received",
                "ai_state": "pending",
                "ai_group": None,
                "confirmed_group": None,
            }
        )
        self.assertIsNone(pending)


if __name__ == "__main__":
    unittest.main()
