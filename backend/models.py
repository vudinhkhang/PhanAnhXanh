from datetime import date
from typing import Annotated, Literal
from urllib.parse import urlsplit
import re

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, StringConstraints, field_validator

Name = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)
]
Email = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        to_lower=True,
        max_length=180,
        pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$",
    ),
]
Note = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)
]


class Login(BaseModel):
    email: Email
    password: str = Field(min_length=1, max_length=128)
    remember: bool = False


class Account(Login):
    name: Name
    password: str = Field(min_length=8, max_length=128)


Areas = Annotated[
    list[
        Annotated[
            str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
        ]
    ],
    Field(max_length=80),
]


class Active(BaseModel):
    active: bool


class StaffCreate(Account):
    areas: Areas = Field(default_factory=list)


class StaffPatch(BaseModel):
    active: bool | None = None
    areas: Areas | None = None


class AdminUserCreate(Account):
    role: Literal["citizen", "staff", "admin"] = "staff"
    areas: Areas = Field(default_factory=list)


class AdminUserPatch(BaseModel):
    role: Literal["citizen", "staff", "admin"] | None = None
    active: bool | None = None
    name: Name | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)
    areas: Areas | None = None


class ProfilePatch(BaseModel):
    name: Name | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)


class MapPin(BaseModel):
    lat: float = Field(ge=-90, le=90, allow_inf_nan=False)
    lng: float = Field(ge=-180, le=180, allow_inf_nan=False)


class Submission(BaseModel):
    pin: MapPin | None = None
    description: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=3000)
    ]
    location: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=3, max_length=240)
    ]
    contact: str | None = Field(default=None, max_length=160)
    photos: list[Annotated[str, Field(max_length=4_500_000)]] = Field(
        default_factory=list, max_length=3
    )
    public: bool = False
    ai_consent: bool = False

    @field_validator("contact")
    @classmethod
    def check_contact(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        is_email = bool(re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", cleaned))
        digits = re.sub(r"\D", "", cleaned)
        is_phone = bool(
            re.fullmatch(r"\+?[0-9][0-9\s.-]{7,18}", cleaned) and 8 <= len(digits) <= 15
        )
        if not (is_email or is_phone):
            raise ValueError("Thông tin liên hệ phải là email hoặc số điện thoại hợp lệ.")
        return cleaned.lower() if is_email else cleaned


class PhotoAnalysisRequest(BaseModel):
    photos: list[Annotated[str, Field(max_length=4_500_000)]] = Field(
        min_length=1, max_length=3
    )


class Assignment(BaseModel):
    assignee: int


class BulkAssignment(Assignment):
    report_ids: list[Annotated[str, StringConstraints(min_length=1, max_length=40)]] = (
        Field(min_length=1, max_length=20)
    )


class Reopen(BaseModel):
    note: Note


class IntakeReview(BaseModel):
    decision: Literal["accept", "reject"]
    group: (
        Literal["water", "waste", "dust", "noise", "flood", "tree", "hazard", "other"]
        | None
    ) = None
    note: Note | None = None
    assignee: int | None = None


class Update(Reopen):
    status: Literal["received", "processing", "resolved", "cancelled"]
    confirmed_group: (
        Literal["water", "waste", "dust", "noise", "flood", "tree", "hazard", "other"]
        | None
    ) = None
    priority: Literal["normal", "high"] = "normal"
    photos: list[Annotated[str, Field(max_length=4_500_000)]] = Field(
        default_factory=list, max_length=3
    )


class LocalUpdate(BaseModel):
    title: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
    ]
    summary: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=400)
    ]
    ward: Annotated[str, StringConstraints(max_length=120)] | None = None
    source_url: HttpUrl
    starts_on: date
    ends_on: date


class LocalUpdatePublication(BaseModel):
    published: bool


def is_news_url(value, image=False):
    if not isinstance(value, str) or len(value) > 2048 or re.search(r"[\s\\]", value):
        return False
    if image and re.fullmatch(r"/images/[\w-]+\.(?:webp|png|jpe?g)", value):
        return True
    try:
        url = urlsplit(value)
        return url.scheme == "https" and bool(url.hostname) and url.username is None
    except ValueError:
        return False


class NewsOperation(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    insert: str | dict[str, str]
    attributes: dict | None = None

    @field_validator("insert")
    @classmethod
    def validate_insert(cls, value):
        if isinstance(value, dict) and (set(value) != {"image"} or not is_news_url(value["image"], image=True)):
            raise ValueError("Dùng liên kết HTTPS cho ảnh trong bài.")
        return value

    @field_validator("attributes")
    @classmethod
    def validate_attributes(cls, value):
        for name, attr in (value or {}).items():
            if (
                (name in {"bold", "italic", "underline", "strike", "blockquote"} and attr is True)
                or (name == "header" and type(attr) is int and attr in (2, 3))
                or (name == "list" and attr in ("ordered", "bullet"))
                or (name == "link" and is_news_url(attr))
            ):
                continue
            raise ValueError("Định dạng trong bài chưa được hỗ trợ.")
        return value


class NewsContent(BaseModel):
    ops: list[NewsOperation] = Field(min_length=1, max_length=4000)

    @field_validator("ops")
    @classmethod
    def validate_ops(cls, value):
        texts = [op.insert for op in value if isinstance(op.insert, str)]
        if sum(map(len, texts)) > 60000 or len(value) - len(texts) > 24:
            raise ValueError("Bài viết tối đa 60.000 ký tự và 24 ảnh.")
        if not any(text.strip() for text in texts):
            raise ValueError("Nhập nội dung bài viết.")
        return value


class NewsEditorial(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
    summary: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] = ""
    category: Literal["waste", "water", "air", "green"]
    area: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    source_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)] = "Phản Ánh Xanh"
    source_url: str | None = None
    image: str | None = None
    content: NewsContent
    published: bool = False
    replaces: str | None = None

    @field_validator("source_url", "image")
    @classmethod
    def validate_urls(cls, value, info):
        if value is not None and not is_news_url(value, image=info.field_name == "image"):
            raise ValueError("Kiểm tra các đường dẫn HTTPS của bài viết.")
        return value
