from __future__ import annotations

import base64
import binascii
import re
from datetime import datetime

from pydantic import Field, field_validator

from app.schemas.base import ApiModel


_AVATAR_PATTERN = re.compile(r"^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$")
_MAX_AVATAR_BYTES = 256 * 1024


class ProfileUpdate(ApiModel):
    display_name: str = Field(max_length=48)
    bio: str = Field(max_length=280)
    location: str = Field(max_length=80)
    avatar_data_url: str = Field(max_length=360_000)

    @field_validator("display_name", "bio", "location")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("avatar_data_url")
    @classmethod
    def validate_avatar(cls, value: str) -> str:
        if not value:
            return value
        match = _AVATAR_PATTERN.fullmatch(value)
        if not match:
            raise ValueError("头像必须是 PNG、JPEG 或 WebP 图片")
        try:
            payload = base64.b64decode(match.group(2), validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError("头像数据无效") from error
        if len(payload) > _MAX_AVATAR_BYTES:
            raise ValueError("头像不能超过 256 KB")
        return value


class UserSummary(ApiModel):
    id: str
    username: str
    display_name: str = ""
    bio: str = ""
    location: str = ""
    avatar_data_url: str = ""
    created_at: datetime


class MessageCreate(ApiModel):
    recipient_id: str = Field(min_length=36, max_length=36)
    body: str = Field(min_length=1, max_length=2000)

    @field_validator("body")
    @classmethod
    def strip_body(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("消息不能为空")
        return value


class ChatMessageResponse(ApiModel):
    id: str
    sender_id: str
    recipient_id: str
    body: str
    created_at: datetime
    read_at: datetime | None


class ConversationResponse(ApiModel):
    user: UserSummary
    last_message: ChatMessageResponse
    unread_count: int
