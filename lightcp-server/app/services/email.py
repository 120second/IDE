from __future__ import annotations

import smtplib
from email.message import EmailMessage
from html import escape
from typing import Protocol

from app.core.config import Settings


class EmailSender(Protocol):
    @property
    def available(self) -> bool: ...

    def send_password_reset(self, recipient: str, code: str, expires_minutes: int) -> None: ...


class SmtpEmailSender:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @property
    def available(self) -> bool:
        return bool(self.settings.smtp_host and self.settings.smtp_from_email)

    def send_password_reset(self, recipient: str, code: str, expires_minutes: int) -> None:
        if not self.available:
            raise RuntimeError("SMTP is not configured")

        message = EmailMessage()
        message["Subject"] = "LightCP 密码重置验证码"
        message["From"] = self.settings.smtp_from_email
        message["To"] = recipient
        message.set_content(
            f"你的 LightCP 密码重置验证码是：{code}\n"
            f"验证码将在 {expires_minutes} 分钟后失效。\n"
            "如果不是你发起的请求，请忽略此邮件。"
        )
        message.add_alternative(
            "<h2>LightCP 密码重置</h2>"
            f"<p>你的验证码是：<strong>{escape(code)}</strong></p>"
            f"<p>验证码将在 {expires_minutes} 分钟后失效。</p>"
            "<p>如果不是你发起的请求，请忽略此邮件。</p>",
            subtype="html",
        )

        with smtplib.SMTP(self.settings.smtp_host, self.settings.smtp_port, timeout=15) as smtp:
            if self.settings.smtp_use_tls:
                smtp.starttls()
            if self.settings.smtp_username:
                smtp.login(self.settings.smtp_username, self.settings.smtp_password)
            smtp.send_message(message)


class MemoryEmailSender:
    """Test-only sender exposed through the application factory."""

    def __init__(self) -> None:
        self.messages: list[tuple[str, str, int]] = []

    @property
    def available(self) -> bool:
        return True

    def send_password_reset(self, recipient: str, code: str, expires_minutes: int) -> None:
        self.messages.append((recipient, code, expires_minutes))
