from __future__ import annotations

from datetime import datetime

from pydantic import EmailStr, Field, field_validator

from app.schemas.base import ApiModel


def _validate_password(value: str) -> str:
    if len(value) < 8 or len(value) > 128:
        raise ValueError("密码长度必须为 8 到 128 个字符")
    return value


class RegisterRequest(ApiModel):
    username: str = Field(min_length=3, max_length=32)
    email: EmailStr
    password: str

    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str) -> str:
        value = value.strip()
        if not all(character.isalnum() or character in "_-" for character in value):
            raise ValueError("用户名只能包含字母、数字、下划线和连字符")
        return value

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return _validate_password(value)


class LoginRequest(ApiModel):
    identifier: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=128)


class ForgotPasswordRequest(ApiModel):
    email: EmailStr


class ResetPasswordRequest(ApiModel):
    email: EmailStr
    code: str = Field(pattern=r"^\d{6}$")
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return _validate_password(value)


class UserResponse(ApiModel):
    id: str
    username: str
    email: str
    created_at: datetime


class TokenResponse(ApiModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: UserResponse


class MessageResponse(ApiModel):
    message: str

