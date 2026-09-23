from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator

from app.schemas.base import ApiModel


class TemplateCategoryInput(ApiModel):
    name: str = Field(min_length=1, max_length=120)
    parent_id: int | None = None
    sort_order: int = Field(default=0, ge=0, le=1_000_000)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("分类名称不能为空")
        return value


class TemplateCategoryResponse(TemplateCategoryInput):
    id: int
    created_at: datetime
    updated_at: datetime


class TemplateInput(ApiModel):
    kind: Literal["snippet", "file"]
    name: str = Field(min_length=1, max_length=120)
    trigger: str = Field(default="", max_length=120)
    aliases: list[str] = Field(default_factory=list, max_length=32)
    description: str = Field(default="", max_length=2000)
    language: str = Field(default="cpp", min_length=1, max_length=32)
    category_id: int | None = None
    favorite: bool = False
    sort_order: int = Field(default=0, ge=0, le=1_000_000)
    code: str = Field(default="", max_length=1_048_576)

    @field_validator("name", "language")
    @classmethod
    def trim_required(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("字段不能为空")
        return value

    @field_validator("aliases")
    @classmethod
    def validate_aliases(cls, aliases: list[str]) -> list[str]:
        normalized: list[str] = []
        for alias in aliases:
            value = alias.strip()
            if value and value not in normalized:
                normalized.append(value[:64])
        return normalized


class TemplateResponse(TemplateInput):
    id: int
    use_count: int
    last_used: datetime | None
    created_at: datetime
    updated_at: datetime


class TemplateFavoriteRequest(ApiModel):
    favorite: bool


class TemplateMoveRequest(ApiModel):
    category_id: int | None = None
    sort_order: int = Field(ge=0, le=1_000_000)


class CategoryMoveRequest(ApiModel):
    parent_id: int | None = None
    sort_order: int = Field(ge=0, le=1_000_000)

