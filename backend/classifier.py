"""Advisory classification of citizen reports.

Local CLIP/TF-IDF by default. Photos only leave the server through vision.py when the
citizen consented; any failure there falls back to the local classifier."""

import re
import unicodedata
from collections import Counter
from functools import lru_cache
from io import BytesIO
from math import log, sqrt
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps

from . import text_model, vision

MODEL_DIR = Path(__file__).resolve().parents[1] / ".runtime/models/clip"
CATEGORIES = ("waste", "water", "dust", "noise", "flood", "tree", "hazard", "other")

# Multiple English captions per category are embedded once by CLIP at setup.
CAPTIONS = {
    "waste": [
        "A photograph of piles of plastic bags and household garbage on a sidewalk.",
        "A photograph of an overflowing rubbish dump with litter scattered along the road.",
        "A photograph of illegal dumping of solid waste in a Vietnamese neighborhood.",
    ],
    "water": [
        "A photograph of a polluted canal with dark stagnant water between houses.",
        "A photograph of sewage and dirty discolored water flowing into a river.",
        "A photograph of a stream covered in foam, algae or dead fish.",
    ],
    "dust": [
        "A photograph of grey airborne dust at a construction site with cranes and scaffolding.",
        "A photograph of thick smoke and industrial air pollution from a chimney.",
        "A photograph of dusty roadwork or smoke from open burning.",
    ],
    "noise": [
        "A photograph of outdoor karaoke speakers and loud street amplifiers at night.",
        "A photograph of noisy late night construction drilling or metal workshop on a street.",
        "A photograph of crowded street-side dining with loudspeakers and amplifiers.",
    ],
    "flood": [
        "A photograph of cars and motorbikes driving through a flooded asphalt city road in heavy rain.",
        "A photograph of floodwater submerging a paved urban street and shopfronts.",
        "A photograph of pedestrians wading knee-deep through street floodwater during a storm.",
    ],
    "tree": [
        "A photograph of a fallen tree blocking a city street or sidewalk.",
        "A photograph of a damaged, chopped down or leaning urban street tree.",
        "A photograph of broken tree branches and damaged green park vegetation.",
    ],
    "hazard": [
        "A photograph of leaking chemical drums, oil spill or toxic waste containers.",
        "A photograph of medical waste syringes, used batteries or industrial solvent barrels.",
        "A photograph of hazardous chemical spill or oil slick on asphalt road.",
    ],
    "other": [
        "A photograph of an ordinary residential neighborhood.",
        "A photograph of a damaged road, broken streetlight or urban infrastructure problem.",
        "A photograph of construction materials blocking a pedestrian sidewalk.",
    ],
}

# Compare a possible structural fire with visually similar, non-emergency scenes.
FIRE_CAPTIONS = (
    "A real photograph of a house on fire, with flames coming out of the roof or windows.",
    "A building engulfed in flames and heavy smoke during an uncontrolled structural fire.",
    "Dense smoke pouring directly out of a burning house in a residential street.",
)
FIRE_LOOKALIKES = (
    "Thin smoke from a chimney or an industrial smokestack without a building fire.",
    "A small open trash fire or burning leaves outdoors next to intact buildings.",
    "A small controlled campfire, cooking flame or barbecue outdoors.",
    "An orange sunset or bright orange lights reflected on houses at night.",
    "A pile of rubble or a charred building after the fire has already been extinguished.",
)
FIRE_TEXT = re.compile(
    r"(?<!khong )(?<!khong co )(?<!chua )\b"
    r"(?:chay (?:nha|chung cu|can ho|toa nha|cua hang)"
    r"|(?:nha|chung cu|can ho|toa nha|cua hang|nha kho|nha xuong|nha may)"
    r" (?:(?:dang|bi) )?(?:boc )?chay"
    r"|xe (?:(?:dang|bi) )?boc chay|hoa hoan|dam chay lon)\b"
)
SMOKE_TEXT = re.compile(r"\b(?:khoi (?:boc|den|trang|day|mu|tu|len)|boc khoi|cot khoi)\b")
SMOKE_SOURCE = re.compile(
    r"\b(?:cong truong|ong khoi|xe (?:ben|cho cat)|dot (?:rac|la|rom)|lo dot|bep than)\b"
)

# Short Vietnamese exemplar descriptions for a word and word-pair TF-IDF classifier.
# Common filler does not contribute to the match. Accent folding also covers
# descriptions typed without Vietnamese input methods.
EXAMPLES = {
    "waste": [
        "rác thải sinh hoạt chất đống",
        "bao rác túi nilon chai nhựa vứt bừa bãi",
        "đổ trộm phế thải xây dựng xà bần",
        "thùng rác đầy tràn ra vỉa hè",
        "bãi rác tự phát bốc mùi",
        "phế liệu đổ ven đường",
        "rác chưa được thu gom",
        "đống xà bần gạch vụn bị đổ ven hẻm",
        "đồ đạc cũ bị vứt cạnh thùng rác công cộng",
        "rác",
    ],
    "water": [
        "nước thải đen ngòm có mùi hôi",
        "nước kênh ô nhiễm đổi màu",
        "xả thải xuống sông suối hồ",
        "nước ao đục nổi váng dầu",
        "cá chết hàng loạt trên mặt nước",
        "nước chảy từ cống xả bọt trắng",
        "nước giếng nhiễm bẩn",
        "nước thải đổ ra kênh rạch",
        "ống xả chảy nước nâu đục xuống rạch",
        "mặt nước phủ bọt có mùi cống",
    ],
    "dust": [
        "khói bụi dày đặc",
        "bụi mịn từ công trường xây dựng",
        "ống khói nhà máy xả khói đen",
        "đốt rác tạo khói mù mịt khó thở",
        "xe chở cát làm bụi bay vào nhà",
        "không khí ô nhiễm do khí thải",
        "đốt phế liệu phát tán khói",
        "bụi đường phủ trắng khu dân cư",
        "xe ben chạy qua cuốn bụi mù mịt",
        "khói xám từ lò đốt phả vào khu dân cư",
    ],
    "noise": [
        "tiếng ồn lớn vào ban đêm",
        "hát karaoke loa kẹo kéo quá giờ",
        "quán nhậu mở nhạc công suất lớn gây ồn",
        "công trình thi công khoan đục đêm khuya",
        "xưởng cơ khí cưa xẻ ồn ào khu dân cư",
        "hàng xóm bật loa kéo quá nửa đêm",
        "tiếng máy nổ ầm ầm làm mất ngủ",
        "tiếng ồn",
    ],
    "flood": [
        "ngập nước kéo dài sau mưa triều cường",
        "miệng cống hố ga bị rác bít tắc",
        "nước cống trào ngược ngập đường hẻm",
        "đọng nước bẩn mất vệ sinh",
        "thoát nước kém gây ngập úng đô thị",
        "cống nghẹt nước tràn lên đường",
        "mưa xong nước dâng ngập lối đi",
        "ngập úng",
    ],
    "tree": [
        "cây xanh gãy đổ chắn ngang đường",
        "cây cổ thụ nghiêng sâu mục nguy hiểm",
        "chặt phá bức tử cây xanh đường phố",
        "cành cây gãy vướng dây điện",
        "lấn chiếm mảng xanh công viên",
        "cành me bị tét sau giông",
        "nhánh cây nứt treo lơ lửng trên vỉa hè",
        "cây xanh",
    ],
    "hazard": [
        "rò rỉ hóa chất bốc mùi độc hại",
        "đổ trộm dầu nhớt thải dung môi",
        "rác thải y tế kim tiêm vứt bừa bãi",
        "pin ắc quy hóa chất công nghiệp",
        "rò rỉ khí gas mùi khét nguy hiểm",
        "tràn hóa chất dầu nhớt",
        "can thuốc trừ sâu rỉ ra đất",
        "chai dung dịch ăn mòn đổ trên lề đường",
    ],
    "other": [
        "vật liệu xây dựng lấn chiếm vỉa hè lối đi",
        "sạt lở bờ kênh nguy hiểm",
        "đèn đường công cộng bị hỏng",
        "mặt đường hư hỏng sụt lún",
        "xác động vật bốc mùi trên đường",
        "mất vệ sinh công cộng khác",
        "xác chó chết bốc mùi ở mé đường",
        "mặt đường sụp tạo hố sâu bất thường",
    ],
}

URGENT_TERMS = (
    "khẩn cấp",
    "nguy hiểm",
    "cháy lớn",
    "đám cháy",
    "khó thở",
    "ngộ độc",
    "cá chết hàng loạt",
    "tràn hóa chất",
    "rò rỉ hóa chất",
    "rò rỉ khí",
    "dầu tràn",
    "tràn dầu",
    "sạt lở",
    "khói dày đặc",
    "khói đen dày đặc",
)

GROUP_LABELS = {
    "waste": "Rác thải",
    "water": "Ô nhiễm nước",
    "dust": "Khói và bụi",
    "noise": "Tiếng ồn",
    "flood": "Ngập nước và tắc cống",
    "tree": "Cây xanh và cảnh quan",
    "hazard": "Hóa chất và chất thải nguy hại",
    "other": "Vấn đề môi trường khác",
}

PHOTO_SUGGESTIONS = {
    "fire": [
        "Phát hiện khói và dấu hiệu cháy tại khu vực này, cần lực lượng chức năng kiểm tra khẩn cấp.",
        "Có khói dày và nguy cơ hỏa hoạn gần khu dân cư, đề nghị xử lý và cảnh báo an toàn ngay.",
    ],
    "waste": [
        "Rác thải sinh hoạt tồn đọng thành đống trên vỉa hè/lòng đường, gây mùi hôi và mất mỹ quan.",
        "Thùng rác công cộng quá tải hoặc có điểm đổ trộm rác thải bừa bãi chưa được thu gom.",
        "Phế thải và túi nilon tập kết sai quy định, cần đơn vị vệ sinh môi trường thu dọn.",
    ],
    "water": [
        "Nước kênh/cống chuyển màu đen đục, nổi bọt hoặc rác thải gây mùi hôi nặng cho khu dân cư.",
        "Phát hiện dấu hiệu xả nước thải chưa xử lý ra kênh rạch/mương thoát nước.",
        "Mặt nước ô nhiễm, có váng bẩn hoặc cá chết dọc bờ kênh, cần kiểm tra nguồn xả.",
    ],
    "dust": [
        "Khói bụi dày đặc phát tán từ công trình/hoạt động đốt thải gây ngột ngạt và giảm tầm nhìn.",
        "Bụi xây dựng hoặc xe chở vật liệu không che chắn làm bụi bay vào nhà dân xung quanh.",
        "Khu vực có khói thải kéo dài gây khó thở, cần kiểm tra và nhắc nhở biện pháp che chắn.",
    ],
    "noise": [
        "Tiếng ồn lớn từ loa công suất cao/hoạt động thi công ảnh hưởng sinh hoạt khu dân cư.",
        "Phát sinh tiếng ồn kéo dài gây mất trật tự và ảnh hưởng nghỉ ngơi của người dân.",
    ],
    "flood": [
        "Nước ngập sâu mặt đường và vỉa hè, thoát nước chậm gây cản trở giao thông và sinh hoạt.",
        "Miệng cống/hố ga bị rác hoặc bùn đất bít tắc khiến nước trào ngược ngập lối đi.",
        "Khu vực bị úng ngập sau mưa hoặc triều cường, cần khơi thông cống rãnh khẩn trương.",
    ],
    "tree": [
        "Cây xanh đô thị bị gãy đổ hoặc cành lớn nứt treo có nguy cơ chắn lối đi và mất an toàn.",
        "Cây trồng trên vỉa hè bị nghiêng bật gốc hoặc vướng dây điện, cần đội cây xanh xử lý.",
        "Nhánh cây gãy sau gió lớn nằm chắn vỉa hè/lòng đường, cần cắt tỉa và thu dọn.",
    ],
    "hazard": [
        "Phát hiện thùng chứa hóa chất, dầu nhớt rò rỉ hoặc chất thải nguy hại đổ bừa bãi trên mặt đường.",
        "Có chất thải y tế/hóa chất công nghiệp tiềm ẩn nguy cơ độc hại, cần khoanh vùng xử lý ngay.",
        "Vệt dầu loang hoặc dung dịch nghi hóa chất gây trơn trượt và bốc mùi khét nguy hiểm.",
    ],
    "other": [
        "Ghi nhận sự cố hạ tầng/môi trường đô thị tại khu vực này gây ảnh hưởng sinh hoạt và lối đi.",
        "Hiện trường có vật cản/hư hỏng mất vệ sinh công cộng, đề nghị cán bộ địa bàn kiểm tra.",
    ],
}


def _words(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value.lower().replace("đ", "d"))
    plain = "".join(c for c in decomposed if not unicodedata.combining(c))
    return " ".join(re.findall(r"[a-z0-9]+", plain))


def reports_fire(description: str) -> bool:
    return bool(FIRE_TEXT.search(_words(description)))


def unexplained_smoke(description: str) -> bool:
    text = _words(description)
    return bool(SMOKE_TEXT.search(text) and not SMOKE_SOURCE.search(text))


def urgent_description(description: str) -> bool:
    sentence = " " + _words(description) + " "
    return any(" " + _words(phrase) + " " in sentence for phrase in URGENT_TERMS)


def _terms(value: str) -> Counter:
    words = _words(value).split()
    # Accent folding merges several common function words (e.g. đây, đầy, dày).
    # Keep them as context in word-pairs but ignore their standalone evidence.
    stopwords = {
        "anh",
        "bao",
        "bi",
        "can",
        "cho",
        "co",
        "cua",
        "da",
        "dan",
        "day",
        "de",
        "duoc",
        "giua",
        "khi",
        "khu",
        "la",
        "lam",
        "len",
        "lon",
        "mat",
        "mot",
        "nay",
        "nguoi",
        "nhieu",
        "o",
        "qua",
        "ra",
        "rat",
        "tai",
        "theo",
        "trong",
        "tren",
        "tu",
        "va",
        "vao",
        "ve",
        "voi",
    }
    terms = Counter(word for word in words if word not in stopwords)
    for first, second in zip(words, words[1:]):
        terms[first + " " + second] += 2
    return terms


def _unit(mapping: dict) -> dict:
    size = sqrt(sum(v * v for v in mapping.values())) or 1
    return {key: value / size for key, value in mapping.items()}


@lru_cache(maxsize=1)
def _text_index():
    records = [
        (category, _terms(s)) for category, rows in EXAMPLES.items() for s in rows
    ]
    counts = Counter(term for _, terms in records for term in terms)
    idf = {
        term: log((len(records) + 1) / (freq + 1)) + 1 for term, freq in counts.items()
    }
    vectors = [
        (category, _unit({k: v * idf[k] for k, v in terms.items()}))
        for category, terms in records
    ]
    return idf, vectors


def _baseline_text_scores(description: str) -> np.ndarray:
    idf, vectors = _text_index()
    terms = _terms(description)
    query = _unit({k: v * idf[k] for k, v in terms.items() if k in idf})
    matches = {key: [] for key in CATEGORIES}
    for category, vector in vectors:
        matches[category].append(
            sum(value * query.get(term, 0) for term, value in vector.items())
        )
    scores = []
    for category in CATEGORIES:
        first, second = sorted(matches[category], reverse=True)[:2]
        scores.append(0.85 * first + 0.15 * second)
    return np.array(scores)


def _text_scores(description: str, *, baseline=None) -> np.ndarray:
    if baseline is None:
        baseline = _baseline_text_scores(description)
    model = text_model.load_model(CATEGORIES)
    if model is None:
        return baseline
    return model.supplement(baseline, model.predict(text_model.features(_words(description))))


def _session(path: Path) -> ort.InferenceSession:
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    return ort.InferenceSession(str(path), options, providers=["CPUExecutionProvider"])


@lru_cache(maxsize=1)
def _vision_model():
    return _session(MODEL_DIR / "onnx/vision_model_quantized.onnx"), np.load(
        MODEL_DIR / "prototypes.npy"
    )


def photo_evidence(photos: list[bytes]) -> tuple[np.ndarray, np.ndarray]:
    model, prototypes = _vision_model()
    batch = []
    for data in photos:
        with Image.open(BytesIO(data)) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
            crop = ImageOps.fit(image, (224, 224), method=Image.Resampling.BICUBIC)
            pixels = np.asarray(crop, dtype=np.float32) / 255.0
        normalized = (pixels - [0.48145466, 0.4578275, 0.40821073]) / [
            0.26862954,
            0.26130258,
            0.27577711,
        ]
        batch.append(normalized.transpose(2, 0, 1))
    (embeddings,) = model.run(
        ["image_embeds"], {"pixel_values": np.asarray(batch, dtype=np.float32)}
    )
    embeddings /= np.linalg.norm(embeddings, axis=1, keepdims=True).clip(1e-8)
    # Normalize each photo's votes before pooling so every submitted photo counts.
    logits = 70.0 * (embeddings @ prototypes.T)
    exp = np.exp(logits - logits.max(axis=1, keepdims=True))
    return exp / exp.sum(axis=1, keepdims=True), embeddings


@lru_cache(maxsize=1)
def _fire_prototypes() -> tuple[np.ndarray, np.ndarray]:
    from tokenizers import Tokenizer

    model = _session(MODEL_DIR / "onnx/text_model_quantized.onnx")
    tokenizer = Tokenizer.from_file(str(MODEL_DIR / "tokenizer.json"))
    vectors = []
    for caption in FIRE_CAPTIONS + FIRE_LOOKALIKES:
        tokens = np.array([tokenizer.encode(caption).ids], dtype=np.int64)
        (embedding,) = model.run(["text_embeds"], {"input_ids": tokens})
        vectors.append(embedding[0] / np.linalg.norm(embedding[0]))
    count = len(FIRE_CAPTIONS)
    return np.stack(vectors[:count]), np.stack(
        vectors[count:] + list(_vision_model()[1])
    )


def possible_fire_photos(embeddings: np.ndarray, *, include_ambiguous=False) -> list[int]:
    fire, alternatives = _fire_prototypes()
    fire_score = (embeddings @ fire.T).max(axis=1)
    alternative_score = (embeddings @ alternatives.T).max(axis=1)
    # This margin raises a review flag. CLIP similarities are not probabilities.
    margin = fire_score - alternative_score
    matches = (fire_score >= 0.23) & (margin >= 0.025)
    if include_ambiguous:
        # Near ties with strong fire evidence warrant review when the smoke
        # source is unknown, including the image-only preview.
        matches |= (fire_score >= 0.27) & (margin >= -0.025)
    return (np.flatnonzero(matches) + 1).tolist()


def _confident(text: np.ndarray, photo: np.ndarray) -> bool:
    """True when the local CLIP and TF-IDF models agree with strong margin."""
    text_top, text_next = sorted(text, reverse=True)[:2]
    photo_top, photo_next = sorted(photo, reverse=True)[:2]
    index = int(photo.argmax())
    return bool(
        CATEGORIES[index] != "other"
        and text.argmax() == index
        and text_top >= 0.25
        and text_top - text_next >= 0.09
        and photo_top >= 0.50
        and photo_top - photo_next >= 0.24
    )


def _local(
    description: str, photos: list[bytes]
) -> tuple[str, bool, np.ndarray, np.ndarray | None, bool]:
    text = _text_scores(description)
    if reports_fire(description):
        return "other", True, text, None, True
    photo = None
    if photos:
        votes, embeddings = photo_evidence(photos)
        if possible_fire_photos(embeddings, include_ambiguous=unexplained_smoke(description)):
            return "other", True, text, None, True
        photo = votes.mean(axis=0)
    if photo is not None:
        if float(text.max()) < 0.15 and float(photo.max()) < 0.45:
            category = "other"
        else:
            category = CATEGORIES[int((2.0 * text + photo).argmax())]
    else:
        category = CATEGORIES[int(text.argmax())] if text.max() >= 0.15 else "other"
    return category, urgent_description(description), text, photo, False


def classify(description: str, photos: list[bytes]) -> tuple[str, bool]:
    """Suggest a category and flag early review; never change the official result."""
    return _local(description, photos)[:2]


def analyze(
    description: str, photos: list[bytes], allow_external: bool = False
) -> dict:
    """Return {group, urgent, summary, source, rejected}. Local CLIP first, DeepSeek when uncertain."""
    local_group, local_urgent, text, photo, fire = _local(description, photos)
    if fire:
        return {
            "group": "other",
            "urgent": True,
            "summary": "Có dấu hiệu cháy, cần xác minh.",
            "source": "clip",
            "rejected": False,
        }
    if (
        photo is not None
        and allow_external
        and vision.configured()
        and not _confident(text, photo)
    ):
        try:
            result = vision.analyze(description, photos)
            if result.get("suspected_fire"):
                return {
                    "group": "other",
                    "urgent": True,
                    "summary": "Có dấu hiệu cháy, cần xác minh.",
                    "source": "deepseek",
                    "rejected": False,
                }
            if not result.get("relevant", True):
                return {
                    "group": "other",
                    "urgent": False,
                    "summary": result["summary"],
                    "source": "deepseek",
                    "rejected": True,
                }
            return {
                "group": result["group"],
                "urgent": result["urgent"] or local_urgent,
                "summary": result["summary"],
                "source": "deepseek",
                "rejected": False,
            }
        except Exception as error:
            vision.log.warning("Vision API unavailable, using local model: %s", error)
    rejected = bool(
        photo is not None and float(text.max()) < 0.15 and float(photo.max()) < 0.45
    )
    return {
        "group": "other" if rejected else local_group,
        "urgent": False if rejected else local_urgent,
        "summary": None,
        "source": "clip",
        "rejected": rejected,
    }


def _inspect_photo_quality(index: int, data: bytes) -> tuple[list[str], dict]:
    """Inspect resolution, brightness, contrast, and sharpness using PIL/NumPy."""
    warnings: list[str] = []
    with Image.open(BytesIO(data)) as source:
        image = ImageOps.exif_transpose(source)
        w, h = image.size
        if min(w, h) < 240:
            warnings.append(f"Ảnh số {index} có độ phân giải thấp ({w}×{h}), nên chọn ảnh rõ hơn.")
        sample = image.convert("L")
        sample.thumbnail((360, 360))
        gray = np.asarray(sample, dtype=np.float32)
    mean_lum = float(gray.mean())
    std_lum = float(gray.std())
    if gray.shape[0] >= 3 and gray.shape[1] >= 3:
        lap = (
            -4.0 * gray[1:-1, 1:-1]
            + gray[:-2, 1:-1]
            + gray[2:, 1:-1]
            + gray[1:-1, :-2]
            + gray[1:-1, 2:]
        )
        sharpness = float(lap.var())
    else:
        sharpness = 0.0
    if mean_lum < 38:
        warnings.append(f"Ảnh số {index} hơi tối, khó quan sát chi tiết hiện trường.")
    elif mean_lum > 242:
        warnings.append(f"Ảnh số {index} bị lóa sáng, có thể mất chi tiết sự cố.")
    if std_lum < 14 or sharpness < 28:
        warnings.append(f"Ảnh số {index} hơi mờ hoặc thiếu độ nét, nên chụp lại rõ hơn.")
    return warnings, {"brightness": round(mean_lum, 1), "sharpness": round(sharpness, 1)}


def analyze_photos_preview(photos: list[bytes]) -> dict:
    """Fast local photo quality check + CLIP incident classification & Vietnamese suggestions."""
    warnings: list[str] = []
    metrics: list[dict] = []
    for idx, data in enumerate(photos, start=1):
        try:
            w_list, m = _inspect_photo_quality(idx, data)
            warnings.extend(w_list)
            metrics.append(m)
        except Exception:
            warnings.append(f"Không đọc được thông số ảnh số {idx}.")

    group = "other"
    urgent = False
    confidence = 0.0
    suggestion_key = "other"
    clip_available = False

    try:
        votes, embeddings = photo_evidence(photos)
        clip_available = True
        fire_photos = possible_fire_photos(embeddings, include_ambiguous=True)
        if fire_photos:
            group = "other"
            urgent = True
            suggestion_key = "fire"
            warnings.insert(
                0,
                "Phát hiện dấu hiệu khói/cháy trong ảnh. Nếu có cháy đang xảy ra, hãy gọi ngay 114.",
            )
        else:
            mean_votes = votes.mean(axis=0)
            best_idx = int(mean_votes.argmax())
            top_score = float(mean_votes[best_idx])
            confidence = round(top_score, 2)
            if top_score < 0.36:
                group = "other"
                suggestion_key = "other"
                warnings.append(
                    "Ảnh chưa thể hiện rõ sự cố môi trường cụ thể, bạn nên mô tả rõ thêm bằng chữ."
                )
            else:
                group = CATEGORIES[best_idx]
                suggestion_key = group
                if group in ("hazard", "flood"):
                    urgent = True

            if len(photos) >= 2:
                unrelated = False
                for left in range(len(photos)):
                    for right in range(left + 1, len(photos)):
                        sim = float(embeddings[left] @ embeddings[right])
                        g_l = CATEGORIES[int(votes[left].argmax())] if votes[left].max() >= 0.45 else None
                        g_r = CATEGORIES[int(votes[right].argmax())] if votes[right].max() >= 0.45 else None
                        if sim < 0.56 or (g_l and g_r and g_l != g_r and sim < 0.72):
                            unrelated = True
                            break
                    if unrelated:
                        break
                if unrelated:
                    warnings.append(
                        "Các ảnh có thể không chụp cùng một hiện trường, nên giữ các ảnh của cùng một sự việc."
                    )
    except Exception:
        clip_available = False

    quality_ok = len(warnings) == 0
    if not clip_available and not warnings:
        status_text = "Ảnh rõ nét · Hệ thống đã kiểm tra độ sáng và độ nét."
    elif quality_ok:
        status_text = f"Ảnh rõ nét · Nhận diện: {GROUP_LABELS.get(group, GROUP_LABELS['other'])}"
    else:
        status_text = warnings[0]

    suggestions = list(PHOTO_SUGGESTIONS.get(suggestion_key, PHOTO_SUGGESTIONS["other"]))
    return {
        "group": group,
        "group_label": "Nghi có cháy nổ" if suggestion_key == "fire" else GROUP_LABELS.get(group, GROUP_LABELS["other"]),
        "urgent": urgent,
        "confidence": confidence,
        "quality_ok": quality_ok,
        "status_text": status_text,
        "warnings": warnings,
        "suggestions": suggestions,
        "metrics": metrics,
    }
