from __future__ import annotations

import logging
import uuid
from datetime import timedelta

from sqlalchemy import or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import AppError
from app.core.security import (
    create_access_token,
    generate_reset_code,
    hash_password,
    normalize_identity,
    reset_code_digest,
    reset_code_matches,
    verify_password,
)
from app.core.time import ensure_utc, utcnow
from app.db.models.password_reset import PasswordResetCode
from app.db.models.template import Template
from app.db.models.user import User
from app.schemas.auth import RegisterRequest, TokenResponse, UserResponse
from app.services.email import EmailSender


logger = logging.getLogger(__name__)


class AuthService:
    def __init__(self, settings: Settings, email_sender: EmailSender) -> None:
        self.settings = settings
        self.email_sender = email_sender

    def register(self, session: Session, request: RegisterRequest) -> TokenResponse:
        username_normalized = normalize_identity(request.username)
        email = str(request.email).strip()
        email_normalized = normalize_identity(email)

        duplicate = session.scalar(
            select(User).where(
                or_(
                    User.username_normalized == username_normalized,
                    User.email_normalized == email_normalized,
                )
            )
        )
        if duplicate:
            if duplicate.username_normalized == username_normalized:
                raise AppError(409, "USERNAME_TAKEN", "该用户名已被使用。", field="username")
            raise AppError(409, "EMAIL_TAKEN", "该邮箱已被注册。", field="email")

        user = User(
            username=request.username.strip(),
            username_normalized=username_normalized,
            email=email,
            email_normalized=email_normalized,
            password_hash=hash_password(request.password),
        )
        session.add(user)
        try:
            session.flush()
            session.add_all(default_templates(user.id))
            session.commit()
        except IntegrityError as error:
            session.rollback()
            raise AppError(409, "ACCOUNT_ALREADY_EXISTS", "用户名或邮箱已被使用。") from error
        session.refresh(user)
        return self.issue_token(user)

    def login(self, session: Session, identifier: str, password: str) -> TokenResponse:
        normalized = normalize_identity(identifier)
        user = session.scalar(
            select(User).where(
                or_(
                    User.username_normalized == normalized,
                    User.email_normalized == normalized,
                )
            )
        )
        if not user or not user.is_active or not verify_password(password, user.password_hash):
            raise AppError(401, "INVALID_CREDENTIALS", "用户名、邮箱或密码不正确。")
        return self.issue_token(user)

    def issue_token(self, user: User) -> TokenResponse:
        token, expires_at = create_access_token(
            user_id=user.id,
            token_version=user.token_version,
            settings=self.settings,
        )
        return TokenResponse(
            access_token=token,
            expires_at=expires_at,
            user=UserResponse.model_validate(user),
        )

    def request_password_reset(self, session: Session, email: str) -> None:
        # Check service-wide availability before looking up the account. This
        # keeps the response identical for registered and unknown addresses.
        if not self.email_sender.available:
            raise AppError(
                503,
                "EMAIL_SERVICE_UNAVAILABLE",
                "邮件服务暂未配置，当前无法发送密码重置验证码。",
            )

        email_normalized = normalize_identity(email)
        user = session.scalar(select(User).where(User.email_normalized == email_normalized))
        if not user or not user.is_active:
            return

        now = utcnow()
        latest = session.scalar(
            select(PasswordResetCode)
            .where(PasswordResetCode.user_id == user.id)
            .order_by(PasswordResetCode.created_at.desc())
        )
        if latest and ensure_utc(latest.created_at) > now - timedelta(seconds=60):
            return
        session.execute(
            update(PasswordResetCode)
            .where(
                PasswordResetCode.user_id == user.id,
                PasswordResetCode.consumed_at.is_(None),
            )
            .values(consumed_at=now)
        )
        record = PasswordResetCode(
            id=str(uuid.uuid4()),
            user_id=user.id,
            code_digest="pending",
            expires_at=now + timedelta(minutes=self.settings.reset_code_expire_minutes),
        )
        code = generate_reset_code()
        record.code_digest = reset_code_digest(record.id, code, self.settings.reset_code_secret)
        session.add(record)
        session.commit()

        try:
            self.email_sender.send_password_reset(
                user.email,
                code,
                self.settings.reset_code_expire_minutes,
            )
        except Exception:
            logger.exception("Could not send password reset email")

    def reset_password(self, session: Session, email: str, code: str, new_password: str) -> None:
        email_normalized = normalize_identity(email)
        user = session.scalar(select(User).where(User.email_normalized == email_normalized))
        if not user or not user.is_active:
            raise AppError(400, "INVALID_RESET_CODE", "验证码无效或已过期。")

        record = session.scalar(
            select(PasswordResetCode)
            .where(
                PasswordResetCode.user_id == user.id,
                PasswordResetCode.consumed_at.is_(None),
            )
            .order_by(PasswordResetCode.created_at.desc())
        )
        now = utcnow()
        if (
            not record
            or ensure_utc(record.expires_at) <= now
            or record.attempt_count >= 5
        ):
            raise AppError(400, "INVALID_RESET_CODE", "验证码无效或已过期。")

        if not reset_code_matches(record.id, code, self.settings.reset_code_secret, record.code_digest):
            record.attempt_count += 1
            if record.attempt_count >= 5:
                record.consumed_at = now
            session.commit()
            raise AppError(400, "INVALID_RESET_CODE", "验证码无效或已过期。")

        record.consumed_at = now
        user.password_hash = hash_password(new_password)
        user.token_version += 1
        user.updated_at = now
        session.commit()


def default_templates(user_id: str) -> list[Template]:
    return [
        Template(
            user_id=user_id,
            kind="file",
            name="Empty C++",
            aliases_json='["empty", "空白"]',
            description="An empty C++ source file.",
            language="cpp",
            sort_order=0,
            code="",
        ),
        Template(
            user_id=user_id,
            kind="file",
            name="Contest C++",
            aliases_json='["contest", "竞赛"]',
            description="Single-test competitive programming entry point.",
            language="cpp",
            sort_order=1,
            code=(
                "#include <bits/stdc++.h>\n"
                "using namespace std;\n\n"
                "void solve() {\n    \n}\n\n"
                "int main() {\n"
                "    ios::sync_with_stdio(false);\n"
                "    cin.tie(nullptr);\n\n"
                "    solve();\n"
                "    return 0;\n"
                "}\n"
            ),
        ),
        Template(
            user_id=user_id,
            kind="file",
            name="Multi Test C++",
            aliases_json='["multi", "多测"]',
            description="Competitive programming entry point with multiple test cases.",
            language="cpp",
            sort_order=2,
            code=(
                "#include <bits/stdc++.h>\n"
                "using namespace std;\n\n"
                "void solve() {\n    \n}\n\n"
                "int main() {\n"
                "    ios::sync_with_stdio(false);\n"
                "    cin.tie(nullptr);\n\n"
                "    int tests;\n"
                "    cin >> tests;\n"
                "    while (tests--) solve();\n"
                "    return 0;\n"
                "}\n"
            ),
        ),
    ]
