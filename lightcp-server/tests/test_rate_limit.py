import pytest
from conftest import register_user

from app.core.errors import AppError
from app.core.rate_limit import RateLimiter


def test_sliding_windows_expire_and_keep_identities_separate():
    now = [0.0]
    limiter = RateLimiter(clock=lambda: now[0])
    limiter.check("login", "alice", 2, 60)
    limiter.check("login", "alice", 2, 60)
    with pytest.raises(AppError) as failure:
        limiter.check("login", "alice", 2, 60)
    assert failure.value.status_code == 429
    limiter.check("login", "bob", 2, 60)
    now[0] = 60
    limiter.check("login", "alice", 2, 60)


def test_limiter_bounds_memory_without_resetting_active_windows():
    now = [0.0]
    limiter = RateLimiter(clock=lambda: now[0], max_keys=1)
    limiter.check("login", "alice", 1, 60)
    with pytest.raises(AppError):
        limiter.check("login", "bob", 1, 60)
    now[0] = 61
    limiter.check("login", "bob", 1, 60)
    assert len(limiter.windows) == 1


def test_login_is_limited_before_password_work(client):
    for _ in range(15):
        assert client.post("/api/auth/login", json={"identifier": "missing", "password": "wrong-password"}).status_code == 401
    response = client.post("/api/auth/login", json={"identifier": "missing", "password": "wrong-password"})
    assert response.status_code == 429
    assert response.json()["error"]["code"] == "RATE_LIMITED"
    assert "Retry-After" in response.headers


def test_account_limit_applies_across_ip_windows_and_normalizes_case(client, monkeypatch):
    check = client.app.state.rate_limiter.check
    monkeypatch.setattr(client.app.state.rate_limiter, "check", lambda scope, identity, limit, seconds: None if scope == "/api/auth/login" else check(scope, identity, limit, seconds))
    for index in range(20):
        identifier = "MISSING" if index % 2 else "missing"
        assert client.post("/api/auth/login", json={"identifier": identifier, "password": "wrong-password"}).status_code == 401
    assert client.post("/api/auth/login", json={"identifier": "missing", "password": "wrong-password"}).status_code == 429


def test_message_limit_does_not_count_reads(client, alice_headers):
    bob = register_user(client, username="bob", email="bob@example.com")
    path = f"/api/community/messages/{bob['user']['id']}"
    for _ in range(40):
        assert client.get(path, headers=alice_headers).status_code == 200
    payload = {"recipientId": bob["user"]["id"], "body": "hello"}
    for _ in range(20):
        assert client.post("/api/community/messages", headers=alice_headers, json=payload).status_code == 201
    response = client.post("/api/community/messages", headers=alice_headers, json=payload)
    assert response.status_code == 429
    assert response.json()["error"]["code"] == "RATE_LIMITED"
