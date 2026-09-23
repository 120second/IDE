from fastapi.testclient import TestClient
from sqlalchemy import select

from conftest import register_user
from app.db.models.user import User


def test_register_login_and_me(client: TestClient) -> None:
    registered = register_user(client, username="Alice_1", email="Alice@Example.com")
    assert registered["tokenType"] == "bearer"
    assert registered["user"]["username"] == "Alice_1"

    by_username = client.post(
        "/api/auth/login",
        json={"identifier": "alice_1", "password": "correct-horse-battery"},
    )
    assert by_username.status_code == 200

    by_email = client.post(
        "/api/auth/login",
        json={"identifier": "ALICE@example.com", "password": "correct-horse-battery"},
    )
    assert by_email.status_code == 200

    me = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {by_email.json()['accessToken']}"},
    )
    assert me.status_code == 200
    assert me.json()["email"] == "Alice@example.com"


def test_duplicate_username_and_email_are_rejected_case_insensitively(client: TestClient) -> None:
    register_user(client)
    username = client.post(
        "/api/auth/register",
        json={
            "username": "ALICE",
            "email": "different@example.com",
            "password": "another-valid-password",
        },
    )
    assert username.status_code == 409
    assert username.json()["error"]["code"] == "USERNAME_TAKEN"

    email = client.post(
        "/api/auth/register",
        json={
            "username": "different",
            "email": "ALICE@EXAMPLE.COM",
            "password": "another-valid-password",
        },
    )
    assert email.status_code == 409
    assert email.json()["error"]["code"] == "EMAIL_TAKEN"


def test_invalid_credentials_and_missing_token_are_rejected(client: TestClient) -> None:
    register_user(client)
    login = client.post(
        "/api/auth/login",
        json={"identifier": "alice", "password": "wrong-password"},
    )
    assert login.status_code == 401
    assert login.json()["error"]["code"] == "INVALID_CREDENTIALS"

    me = client.get("/api/auth/me")
    assert me.status_code == 401
    assert me.json()["error"]["code"] == "AUTHENTICATION_REQUIRED"


def test_validation_errors_use_stable_contract(client: TestClient) -> None:
    response = client.post(
        "/api/auth/register",
        json={"username": "x", "email": "invalid", "password": "short"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_password_is_stored_as_argon2id_hash(client: TestClient) -> None:
    register_user(client, password="plain-password-must-not-remain")
    with client.app.state.database.session_factory() as session:
        user = session.scalar(select(User).where(User.username_normalized == "alice"))
        assert user is not None
        assert user.password_hash.startswith("$argon2id$")
        assert "plain-password-must-not-remain" not in user.password_hash
