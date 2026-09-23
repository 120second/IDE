from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import Settings
from app.main import create_app
from app.services.email import MemoryEmailSender
from app.db.models.password_reset import PasswordResetCode
from conftest import register_user


def test_production_starts_without_smtp_and_forgot_password_is_unavailable(
    tmp_path: Path,
) -> None:
    settings = Settings(
        environment="production",
        database_url=f"sqlite:///{(tmp_path / 'production.db').as_posix()}",
        jwt_secret_key="production-jwt-secret-that-is-long-enough",
        reset_code_secret="different-production-reset-secret-long-enough",
        smtp_host="",
        smtp_from_email="",
    )
    app = create_app(settings, initialize_schema=True)

    with TestClient(app) as client:
        assert client.get("/api/health").status_code == 200
        response = client.post(
            "/api/auth/forgot-password",
            json={"email": "anyone@example.com"},
        )

    assert response.status_code == 503
    assert response.json()["error"] == {
        "code": "EMAIL_SERVICE_UNAVAILABLE",
        "message": "邮件服务暂未配置，当前无法发送密码重置验证码。",
    }


def test_password_reset_sends_code_and_invalidates_old_token(
    client: TestClient,
    email_sender: MemoryEmailSender,
) -> None:
    registered = register_user(client)
    old_token = registered["accessToken"]

    forgot = client.post("/api/auth/forgot-password", json={"email": "alice@example.com"})
    assert forgot.status_code == 202
    assert len(email_sender.messages) == 1
    recipient, code, expires_minutes = email_sender.messages[0]
    assert recipient == "alice@example.com"
    assert len(code) == 6 and code.isdigit()
    assert expires_minutes == 10
    with client.app.state.database.session_factory() as session:
        record = session.scalar(select(PasswordResetCode))
        assert record is not None
        assert record.code_digest != code
        assert len(record.code_digest) == 64

    reset = client.post(
        "/api/auth/reset-password",
        json={
            "email": "alice@example.com",
            "code": code,
            "newPassword": "new-correct-horse-password",
        },
    )
    assert reset.status_code == 200

    old_me = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {old_token}"},
    )
    assert old_me.status_code == 401
    assert old_me.json()["error"]["code"] == "INVALID_TOKEN"

    old_login = client.post(
        "/api/auth/login",
        json={"identifier": "alice", "password": "correct-horse-battery"},
    )
    assert old_login.status_code == 401

    new_login = client.post(
        "/api/auth/login",
        json={"identifier": "alice", "password": "new-correct-horse-password"},
    )
    assert new_login.status_code == 200


def test_forgot_password_does_not_reveal_unknown_email(
    client: TestClient,
    email_sender: MemoryEmailSender,
) -> None:
    response = client.post("/api/auth/forgot-password", json={"email": "missing@example.com"})
    assert response.status_code == 202
    assert email_sender.messages == []


def test_password_reset_email_has_a_short_resend_cooldown(
    client: TestClient,
    email_sender: MemoryEmailSender,
) -> None:
    register_user(client)
    for _ in range(2):
        response = client.post(
            "/api/auth/forgot-password",
            json={"email": "alice@example.com"},
        )
        assert response.status_code == 202
    assert len(email_sender.messages) == 1


def test_reset_code_locks_after_five_failures(
    client: TestClient,
    email_sender: MemoryEmailSender,
) -> None:
    register_user(client)
    client.post("/api/auth/forgot-password", json={"email": "alice@example.com"})
    actual_code = email_sender.messages[0][1]

    for _ in range(5):
        response = client.post(
            "/api/auth/reset-password",
            json={
                "email": "alice@example.com",
                "code": "000000" if actual_code != "000000" else "111111",
                "newPassword": "new-correct-horse-password",
            },
        )
        assert response.status_code == 400

    locked = client.post(
        "/api/auth/reset-password",
        json={
            "email": "alice@example.com",
            "code": actual_code,
            "newPassword": "new-correct-horse-password",
        },
    )
    assert locked.status_code == 400
