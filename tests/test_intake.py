import unittest
from io import BytesIO
from pathlib import Path
from unittest import mock

import numpy as np
from PIL import Image

from backend import classifier, intake, vision


def fixture(name):
    return (Path("public/images") / (name + ".webp")).read_bytes()


class ScreeningTests(unittest.TestCase):
    def test_local_model_understands_short_unaccented_descriptions(self):
        description = "Than cay bi muc va canh da te xuong duong"
        self.assertEqual(intake.assess(description, [], False).group, "tree")
        self.assertEqual(intake.assess(description, [], False).state, "passed")
        self.assertEqual(intake.assess("Có chuyện ở đầu hẻm.", [], False).state, "review")

    def test_house_fire_with_only_smoke_visible_goes_to_review(self):
        photo = (Path("tests/data") / "house-smoke.jpg").read_bytes()
        result = intake.assess("Có khói bốc lên trong khu dân cư.", [photo], False)
        self.assertEqual(
            (result.state, result.reason, result.group, result.urgent, result.photo_numbers),
            ("review", "possible_fire", "other", True, [1]),
        )
        self.assertTrue(classifier.analyze_photos_preview([photo])["urgent"])

    def test_fire_has_priority_over_smoke_group(self):
        for description in ("Nhà đang bốc cháy.", "Chay nha o dau hem"):
            result = intake.assess(description, [], False)
            self.assertEqual(
                (result.state, result.reason, result.group, result.urgent),
                ("review", "possible_fire", "other", True),
            )
        self.assertFalse(classifier.reports_fire("Tôi chạy xe qua, thấy bụi mù."))
        self.assertFalse(classifier.reports_fire("Không có cháy nhà, chỉ có bụi."))
        self.assertFalse(classifier.reports_fire("Đốt rác tạo khói mù mịt."))

        fire, alternatives = classifier._fire_prototypes()
        embeddings = np.stack((alternatives[0], fire[0]))
        dust = classifier.CATEGORIES.index("dust")
        dust_votes = np.eye(len(classifier.CATEGORIES))[[dust, dust]]
        with mock.patch.object(
            classifier, "photo_evidence", return_value=(dust_votes, embeddings)
        ):
            result = intake.assess("Khói bốc lên trong hẻm.", [b"a", b"b"], False)
        self.assertEqual(
            (result.state, result.reason, result.photo_numbers, result.urgent),
            ("review", "possible_fire", [2], True),
        )
        self.assertEqual(
            intake.assess(
                "Khói bụi dày đặc từ công trường.", [fixture("dust")], False
            ).group,
            "dust",
        )

    def test_description_only(self):
        for description in ("aaaaaaaaaa", "asdfghasdfgh", "Xin chào!!!", "123 ... 456"):
            with self.subTest(description=description):
                result = intake.assess(description, [], False)
                self.assertEqual(
                    (result.state, result.reason), ("rejected", "desc_invalid")
                )
        self.assertEqual(
            intake.assess("Tôi quên mật khẩu giúp tôi", [], False).reason,
            "out_of_scope",
        )
        self.assertEqual(
            intake.assess("Rac thai sinh hoat chat dong tren via he.", [], False).state,
            "passed",
        )
        self.assertEqual(
            intake.assess("Cho tôi hỏi sự việc hôm trước", [], False).state, "review"
        )

    def test_individual_images(self):
        description = "Nước thải đen ngòm có mùi hôi ở kênh."
        result = intake.assess(description, [fixture("dust")], False)
        self.assertEqual(
            (result.state, result.reason, result.photo_numbers),
            ("rejected", "image_mismatch", [1]),
        )
        result = intake.assess(
            description, [fixture("water"), fixture("waste"), fixture("dust")], False
        )
        self.assertEqual(
            (result.state, result.reason), ("rejected", "images_unrelated")
        )
        self.assertTrue({1, 3}.issubset(result.photo_numbers))

    def test_same_scene_with_different_framing(self):
        original = fixture("waste")
        images = [original]
        for margin in (0.06, 0.12):
            with Image.open(BytesIO(original)) as source:
                offset = round(source.width * margin)
                crop = source.crop((offset, 0, source.width, source.height))
                out = BytesIO()
                crop.save(out, "WEBP", quality=80)
                images.append(out.getvalue())
        result = intake.assess(
            "Rác thải sinh hoạt chất đống trên vỉa hè.", images, False
        )
        self.assertEqual(result.state, "passed")

    def test_noise_and_external_fallback(self):
        description = "Tiếng ồn lớn do hát karaoke vào ban đêm."
        photos = [fixture("waste")]
        with (
            mock.patch.object(vision, "configured", return_value=True),
            mock.patch.object(
                vision, "assess_intake", side_effect=TimeoutError
            ) as external,
        ):
            self.assertEqual(intake.assess(description, photos, False).state, "review")
            external.assert_not_called()
            self.assertEqual(intake.assess(description, photos, True).state, "review")
            external.assert_called_once()

    def test_unclear_intake_uses_deepseek_and_keeps_disagreements_for_review(self):
        external_result = {
            "group": "dust",
            "urgent": False,
            "summary": "Bụi phát tán từ công trường.",
            "confidence": 0.96,
            "verdict": "consistent",
            "photo_numbers": [],
        }
        with (
            mock.patch.object(vision, "configured", return_value=True),
            mock.patch.object(
                vision, "assess_intake", return_value=external_result
            ) as external,
        ):
            photos = [fixture("dust")]
            self.assertEqual(
                intake.assess("Sự việc ở đầu hẻm.", photos, False).state, "review"
            )
            self.assertEqual(
                intake.assess("Sự việc ở đầu hẻm.", [], False).state, "review"
            )
            external.assert_not_called()
            assisted = intake.assess("Sự việc ở đầu hẻm.", photos, True)
            self.assertEqual(
                (assisted.state, assisted.group, assisted.source),
                ("passed", "dust", "deepseek"),
            )
            conflict = intake.assess(
                "Tiếng ồn lớn do hát karaoke vào ban đêm.", photos, True
            )
            self.assertEqual((conflict.state, conflict.group), ("review", "noise"))

            external.return_value = {**external_result, "verdict": "uncertain"}
            self.assertEqual(
                intake.assess("Sự việc ở đầu hẻm.", [], True).state, "review"
            )
            external.assert_called_with("Sự việc ở đầu hẻm.", [])

            external.return_value = {**external_result, "suspected_fire": True}
            fire = intake.assess("Sự việc ở đầu hẻm.", photos, True)
            self.assertEqual(
                (fire.state, fire.reason, fire.urgent),
                ("review", "possible_fire", True),
            )

    def test_external_checks_photo_indices_and_uncertainty(self):
        data = (
            '{"group":"noise","urgent":false,"summary":"Ảnh không chứng minh được tiếng ồn.",'
            '"confidence":0.99,"verdict":"uncertain","photo_numbers":[1]}'
        )
        with mock.patch.object(vision, "_ask", return_value=data):
            self.assertEqual(
                vision.assess_intake("Tiếng ồn", [fixture("dust")])["photo_numbers"],
                [1],
            )
        with mock.patch.object(vision, "_ask", return_value=data.replace("[1]", "[2]")):
            with self.assertRaises(ValueError):
                vision.assess_intake("Tiếng ồn", [fixture("dust")])
