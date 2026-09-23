from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.services.email import MemoryEmailSender


@pytest.fixture
def email_sender() -> MemoryEmailSender:
    return MemoryEmailSender()


@pytest.fixture
def client(tmp_path: Path, email_sender: MemoryEmailSender) -> Iterator[TestClient]:
    settings = Settings(
        environment="test",
        database_url=f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
        jwt_secret_key="test-jwt-secret-key-that-is-long-enough",
        reset_code_secret="test-reset-code-secret-that-is-long-enough",
        access_token_expire_minutes=60,
    )
    app = create_app(settings, email_sender=email_sender, initialize_schema=True)
    with TestClient(app) as test_client:
        yield test_client


def register_user(
    client: TestClient,
    *,
    username: str = "alice",
    email: str = "alice@example.com",
    password: str = "correct-horse-battery",
) -> dict:
    response = client.post(
        "/api/auth/register",
        json={"username": username, "email": email, "password": password},
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def alice(client: TestClient) -> dict:
    return register_user(client)


@pytest.fixture
def alice_headers(alice: dict) -> dict[str, str]:
    return {"Authorization": f"Bearer {alice['accessToken']}"}

