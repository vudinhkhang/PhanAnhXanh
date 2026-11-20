"""Screen new reports and admit them atomically against the open case list."""

import logging
import re
from dataclasses import dataclass, field, replace
from itertools import combinations
from math import asin, cos, radians, sin, sqrt

from . import classifier, vision

log = logging.getLogger(__name__)
OPEN = ("received", "processing")
REASONS = {
    "desc_invalid": "Mô tả chưa nêu sự việc cụ thể. Hãy mô tả điều bạn quan sát được.",
    "out_of_scope": "Nội dung nằm ngoài phạm vi phản ánh môi trường đô thị.",
    "image_mismatch": "Ảnh được đánh dấu không khớp với mô tả. Hãy thay bằng ảnh của sự việc.",
    "images_unrelated": "Các ảnh được đánh dấu cho thấy những sự việc khác nhau. Hãy gửi ảnh của cùng một sự việc.",
    "duplicate": "Đã có hồ sơ đang xử lý hoặc chờ xử lý cùng nhóm vấn đề tại vị trí này.",
    "possible_duplicate": "Có phản ánh tương tự ở khu vực này. Cán bộ sẽ kiểm tra địa điểm hoặc loại sự việc.",
    "uncertain": "Cần cán bộ kiểm tra thêm mô tả hoặc ảnh hiện trường.",
    "possible_fire": "Hồ sơ có dấu hiệu cháy và đã được chuyển cho cán bộ xem xét sớm.",
    "analysis_error": "Chưa kiểm tra được bằng hệ thống. Hồ sơ đã được chuyển để cán bộ xem.",
}
# Different labels can be complementary evidence of the same event.
RELATED = {
    frozenset(pair)
    for pair in (
        ("waste", "water"),
        ("waste", "flood"),
        ("waste", "dust"),
        ("waste", "hazard"),
        ("water", "flood"),
        ("water", "hazard"),
        ("dust", "hazard"),
        ("tree", "flood"),
        ("tree", "waste"),
    )
}


@dataclass(frozen=True)
class Assessment:
    state: str
    group: str | None = None
    urgent: bool = False
    reason: str | None = None
    photo_numbers: list[int] = field(default_factory=list)
    summary: str | None = None
    source: str | None = None


def invalid_description(description: str) -> bool:
    if re.fullmatch(r"(?:(?:https?://|www\.)\S+\s*)+", description.strip(), re.I):
        return True
    text = classifier._words(description)
    compact = "".join(text.split())
    if not any(char.isalpha() for char in compact):
        return True
    unique = len(set(compact))
    if (len(compact) >= 3 and unique == 1) or (len(compact) >= 6 and unique == 2):
        return True
    if re.fullmatch(r"([a-z]{2,4})\1{2,}", compact):
        return True
    return bool(
        re.fullmatch(
            r"(?:(?:test|testing|thu|hello|hi|xin chao|chao ban|asdf\w*|qwerty\w*|abc\w*|dit me|du ma|vai lon|dm|dmm|cc|cl|\d+)\s*)+",
            text,
        )
    )


def _specific_group(scores, threshold, margin):
    first, second = sorted(
        range(len(scores)), key=lambda index: scores[index], reverse=True
    )[:2]
    name = classifier.CATEGORIES[first]
    return (
        name
        if name != "other"
        and scores[first] >= threshold
        and scores[first] - scores[second] >= margin
        else None
    )


def _conflict(first, second):
    return bool(
        first
        and second
        and first != second
        and "noise" not in (first, second)
        and frozenset((first, second)) not in RELATED
    )


def _supports_group(scores, top_group, expected):
    if top_group == expected:
        return True
    leader = classifier.CATEGORIES[int(scores.argmax())]
    expected_vote = scores[classifier.CATEGORIES.index(expected)]
    return (
        frozenset((leader, expected)) in RELATED
        and expected_vote >= 0.35
        and float(scores.max() - expected_vote) <= 0.15
    )


def assess(description: str, photos: list[bytes], consent: bool) -> Assessment:
    if invalid_description(description):
        return Assessment("rejected", reason="desc_invalid")
    baseline = classifier._baseline_text_scores(description)
    text = classifier._text_scores(description, baseline=baseline)
    text_group = _specific_group(text, 0.25, 0.09)
    normalized = classifier._words(description)
    if not text_group and re.fullmatch(
        r"(?:toi |minh |cho toi )?(?:quen mat khau|khong dang nhap duoc|can doi mat khau|dang ky tai khoan|ban hang online)(?: voi| giup toi| giup minh| a)?",
        normalized,
    ):
        return Assessment("rejected", reason="out_of_scope")
    if classifier.reports_fire(description):
        return Assessment("review", "other", True, "possible_fire", source="clip")
    urgent = classifier.urgent_description(description)
    if not photos:
        group = (
            classifier.CATEGORIES[int(text.argmax())]
            if float(text.max()) >= 0.15
            else "other"
        )
        local = Assessment(
            "passed" if text_group else "review",
            group,
            urgent,
            reason=None if text_group else "uncertain",
            source="clip",
        )
        return _consult_if_needed(description, photos, consent, local, text_group)

    try:
        votes, embeddings = classifier.photo_evidence(photos)
        fire_photos = classifier.possible_fire_photos(
            embeddings, include_ambiguous=classifier.unexplained_smoke(description)
        )
    except Exception as error:
        log.warning("Local photo assessment unavailable (%s)", type(error).__name__)
        local = Assessment("review", text_group, urgent, "analysis_error")
        return _consult_if_needed(description, photos, consent, local, text_group)
    if fire_photos:
        return Assessment(
            "review", "other", True, "possible_fire", fire_photos, source="clip"
        )
    groups = [_specific_group(scores, 0.50, 0.24) for scores in votes]
    combined = 2.0 * text + votes.mean(axis=0)
    candidate = text_group or classifier.CATEGORIES[int(combined.argmax())]
    separate = set()
    visually_distant = False
    for left, right in combinations(range(len(photos)), 2):
        similarity = float(embeddings[left] @ embeddings[right])
        if similarity < 0.58:
            visually_distant = True
        if _conflict(groups[left], groups[right]) and similarity < 0.72:
            separate.update((left + 1, right + 1))
    mismatch_group = _specific_group(baseline, 0.25, 0.09)
    mismatches = [
        index + 1
        for index, group in enumerate(groups)
        if _conflict(mismatch_group, group)
        and votes[index].max() >= 0.60
        and votes[index][classifier.CATEGORIES.index(mismatch_group)] < 0.06
    ]
    support = [
        index
        for index, group in enumerate(groups)
        if text_group and _supports_group(votes[index], group, text_group)
    ]
    if separate:
        local = Assessment(
            "rejected",
            candidate,
            urgent,
            "images_unrelated",
            sorted(separate),
            source="clip",
        )
    elif mismatches:
        local = Assessment(
            "rejected", candidate, urgent, "image_mismatch", mismatches, source="clip"
        )
    elif (
        not visually_distant
        and text_group
        and text_group != "noise"
        and support
        and all(
            index in support
            or (
                not group
                and any(
                    float(embeddings[index] @ embeddings[other]) >= 0.78
                    for other in support
                )
            )
            for index, group in enumerate(groups)
        )
    ):
        return Assessment("passed", text_group, urgent, source="clip")
    else:
        local = Assessment("review", candidate, urgent, "uncertain", source="clip")

    visual_group = groups[0] if all(group == groups[0] for group in groups) else None
    return _consult_if_needed(
        description, photos, consent, local, text_group, visual_group=visual_group
    )


def _consult_if_needed(
    description, photos, consent, local, text_group, *, visual_group=None
):
    if local.state == "passed" or not consent or not vision.configured():
        return local
    try:
        result = vision.assess_intake(description, photos)
    except Exception as error:
        log.warning("External intake assessment unavailable (%s)", type(error).__name__)
        return local
    if result.get("suspected_fire"):
        return Assessment("review", "other", True, "possible_fire", source="deepseek")
    verdict = result["verdict"]
    conflicts = bool(text_group and text_group != result["group"]) or _conflict(
        visual_group, result["group"]
    )
    high_confidence = result["confidence"] >= 0.90 and bool(result["summary"])
    details = {
        "group": local.group if conflicts else result["group"],
        "urgent": local.urgent or result["urgent"],
        "source": "deepseek",
        "summary": result["summary"],
    }
    if (
        high_confidence
        and verdict == "consistent"
        and not conflicts
        and local.state != "rejected"
    ):
        return Assessment("passed", **details)
    if high_confidence and verdict in (
        "desc_invalid",
        "out_of_scope",
        "image_mismatch",
        "images_unrelated",
    ):
        # An external verdict can corroborate a local rejection, or resolve a case
        # where at least one input did not provide a strong local match.
        if (not conflicts or verdict in ("image_mismatch", "images_unrelated")) and (
            local.state != "rejected" or verdict == local.reason
        ):
            return Assessment(
                "rejected",
                reason=verdict,
                photo_numbers=result["photo_numbers"],
                **details,
            )
    return Assessment(
        "review", reason="uncertain", photo_numbers=result["photo_numbers"], **details
    )


def address_key(location: str) -> str:
    expanded = re.sub(r"\bp\.\s*", "phường ", location, flags=re.I)
    expanded = re.sub(r"\bx\.\s*", "xã ", expanded, flags=re.I)
    key = re.sub(r"^so (?=\d)", "", classifier._words(expanded))
    return re.sub(
        r"(?:^| )(?:(?:tp|thanh pho) )?(?:hcm|ho chi minh)$", " tp ho chi minh", key
    ).strip()


def _ward_key(report) -> str | None:
    label = address_key(report["ward"] or report["location"])
    ward = re.search(
        r"\b(?:phuong|xa|thi tran) ([a-z0-9 ]+?)(?=\s+(?:tp|tinh)\s|$)",
        label,
    )
    return ward.group(0) if ward else None


def _full_address(location: str) -> bool:
    return bool(
        re.match(
            r"^(?:so )?\d+\w*(?:\s+\d+\w*)*\s+.+\b(?:phuong|xa|thi tran)\s+\w", location
        )
    )


def _distance(first, second) -> float:
    lat, lng = radians(first["pin_lat"]), radians(first["pin_lng"])
    other_lat, other_lng = radians(second["pin_lat"]), radians(second["pin_lng"])
    value = (
        sin((lat - other_lat) / 2) ** 2
        + cos(lat) * cos(other_lat) * sin((lng - other_lng) / 2) ** 2
    )
    return 12_742_000 * asin(sqrt(min(1.0, value)))


def duplicate_candidate(conn, report, group):
    if not group:
        return None, False
    # All admissions for the same group compare against the latest committed cases.
    conn.execute(
        "SELECT pg_advisory_xact_lock(82614, %s)", (classifier.CATEGORIES.index(group),)
    )
    candidates = conn.execute(
        """SELECT id,description,location,ward,pin_lat,pin_lng FROM reports
           WHERE intake_state='passed' AND status IN ('received','processing')
             AND COALESCE(confirmed_group,ai_group)=%s AND id<>%s
             AND sample_photo IS NULL AND (owner IS NOT NULL OR guest_receipt IS NOT NULL)
           ORDER BY created_at,id""",
        (group, report["id"]),
    ).fetchall()
    nearby = False
    address = address_key(report["location"])
    ward = _ward_key(report)
    for candidate in candidates:
        other_address = address_key(candidate["location"])
        full_match = address == other_address and _full_address(address)
        both_pinned = report["pin_lat"] is not None and candidate["pin_lat"] is not None
        same_place = full_match or (both_pinned and _distance(report, candidate) <= 30)
        if same_place:
            if group != "other" or classifier._words(
                report["description"]
            ) == classifier._words(candidate["description"]):
                return candidate["id"], False
            nearby = True
        elif address and address == other_address and (not both_pinned or full_match):
            nearby = True
        elif (
            not both_pinned
            and ward
            and ward == _ward_key(candidate)
            and not (
                (_full_address(address) or report["pin_lat"] is not None)
                and (_full_address(other_address) or candidate["pin_lat"] is not None)
            )
        ):
            nearby = True
    return None, nearby


def notify(conn, report_id):
    conn.execute(
        "INSERT INTO notifications(report_id) VALUES (%s) ON CONFLICT DO NOTHING",
        (report_id,),
    )


def apply_result(conn, report, result, *, actor=None, note=None, confirmed_group=None):
    root_id = None
    if result.state == "passed":
        root_id, possible = duplicate_candidate(
            conn, report, confirmed_group or result.group
        )
        if root_id:
            result = replace(result, state="rejected", reason="duplicate")
        elif possible and actor is None:
            result = replace(result, state="review", reason="possible_duplicate")
    explanation = note if result.reason == "manual" else REASONS.get(result.reason)
    state = "rejected" if result.state == "rejected" else report["status"]
    conn.execute(
        """UPDATE reports SET intake_state=%s,intake_reason=%s,intake_note=%s,
           intake_photos=%s,duplicate_of=%s,status=%s,ai_group=%s,urgent=%s,
           ai_summary=%s,ai_source=%s,confirmed_group=COALESCE(%s,confirmed_group),
           ai_state=CASE WHEN %s='analysis_error' THEN 'failed' ELSE 'done' END
           WHERE id=%s""",
        (
            result.state,
            result.reason,
            explanation,
            result.photo_numbers,
            root_id,
            state,
            result.group,
            result.urgent,
            result.summary,
            result.source,
            confirmed_group if result.state == "passed" else None,
            result.reason,
            report["id"],
        ),
    )
    history_note = explanation or note or "Cán bộ đã tiếp nhận hồ sơ sau khi kiểm tra."
    if explanation and result.photo_numbers:
        history_note += (
            " Ảnh liên quan: " + ", ".join(map(str, result.photo_numbers)) + "."
        )
    if result.state in ("rejected", "review") or actor is not None:
        conn.execute(
            "INSERT INTO history(report_id,status,note,author) VALUES(%s,%s,%s,%s)",
            (report["id"], state, history_note, actor),
        )
    if result.urgent and result.state != "rejected":
        notify(conn, report["id"])
    return result
