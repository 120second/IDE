from __future__ import annotations

from collections.abc import Generator

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.security import decode_access_token
from app.db.models.user import User


bearer_scheme = HTTPBearer(auto_error=False)


def get_db(request: Request) -> Generator[Session, None, None]:
    yield from request.app.state.database.session()


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    session: Session = Depends(get_db),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise AppError(401, "AUTHENTICATION_REQUIRED", "请先登录。")
    try:
        claims = decode_access_token(credentials.credentials, request.app.state.settings)
        user_id = str(claims["sub"])
        token_version = int(claims["ver"])
    except (jwt.PyJWTError, KeyError, TypeError, ValueError) as error:
        raise AppError(401, "INVALID_TOKEN", "登录状态无效或已过期。") from error

    user = session.scalar(select(User).where(User.id == user_id))
    if not user or not user.is_active or user.token_version != token_version:
        raise AppError(401, "INVALID_TOKEN", "登录状态无效或已过期。")
    return user

