from __future__ import annotations

import hashlib
import hmac
import secrets
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import Settings


_password_hasher = PasswordHasher(
    time_cost=3,
    memory_cost=65536,
    parallelism=4,
    hash_len=32,
    salt_len=16,
    type=Type.ID,
)


def normalize_identity(value: str) -> str:
    return unicodedata.normalize("NFKC", value).strip().casefold()


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password: str, encoded: str) -> bool:
    try:
        return _password_hasher.verify(encoded, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def create_access_token(
    *,
    user_id: str,
    token_version: int,
    settings: Settings,
) -> tuple[str, datetime]:
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=settings.access_token_expire_minutes)
    payload: dict[str, Any] = {
        "sub": user_id,
        "ver": token_version,
        "iat": now,
        "exp": expires_at,
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
    }
    token = jwt.encode(payload, settings.jwt_secret_key, algorithm="HS256")
    return token, expires_at


def decode_access_token(token: str, settings: Settings) -> dict[str, Any]:
    return jwt.decode(
        token,
        settings.jwt_secret_key,
        algorithms=["HS256"],
        issuer=settings.jwt_issuer,
        audience=settings.jwt_audience,
        options={"require": ["sub", "ver", "iat", "exp", "iss", "aud"]},
    )


def generate_reset_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def reset_code_digest(record_id: str, code: str, secret: str) -> str:
    message = f"{record_id}:{code}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def reset_code_matches(record_id: str, code: str, secret: str, digest: str) -> bool:
    expected = reset_code_digest(record_id, code, secret)
    return hmac.compare_digest(expected, digest)

