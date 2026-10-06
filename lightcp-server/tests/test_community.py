from fastapi.testclient import TestClient

from conftest import register_user


def test_profile_can_be_updated_and_searched_without_email(client: TestClient, alice: dict, alice_headers: dict[str, str]) -> None:
    updated = client.put(
        "/api/community/profile",
        headers=alice_headers,
        json={
            "displayName": "Alice Zhang",
            "bio": "ICPC learner",
            "location": "Hangzhou",
            "avatarDataUrl": "",
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["displayName"] == "Alice Zhang"

    bob = register_user(client, username="bob", email="bob@example.com")
    found = client.get(
        "/api/community/users?query=alice",
        headers={"Authorization": f"Bearer {bob['accessToken']}"},
    )
    assert found.status_code == 200
    assert found.json()[0]["displayName"] == "Alice Zhang"
    assert "email" not in found.json()[0]

    unsafe_avatar = client.put(
        "/api/community/profile",
        headers=alice_headers,
        json={
            "displayName": "Alice",
            "bio": "",
            "location": "",
            "avatarDataUrl": "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
        },
    )
    assert unsafe_avatar.status_code == 422


def test_direct_message_round_trip_and_unread_count(client: TestClient, alice: dict, alice_headers: dict[str, str]) -> None:
    bob = register_user(client, username="bob", email="bob@example.com")
    bob_headers = {"Authorization": f"Bearer {bob['accessToken']}"}

    sent = client.post(
        "/api/community/messages",
        headers=alice_headers,
        json={"recipientId": bob["user"]["id"], "body": "  Hello, Bob!  "},
    )
    assert sent.status_code == 201, sent.text
    assert sent.json()["body"] == "Hello, Bob!"

    conversations = client.get("/api/community/conversations", headers=bob_headers)
    assert conversations.status_code == 200
    assert conversations.json()[0]["unreadCount"] == 1
    assert conversations.json()[0]["user"]["username"] == "alice"

    messages = client.get(
        f"/api/community/messages/{alice['user']['id']}", headers=bob_headers
    )
    assert messages.status_code == 200
    assert messages.json()[0]["body"] == "Hello, Bob!"

    conversations = client.get("/api/community/conversations", headers=bob_headers)
    assert conversations.json()[0]["unreadCount"] == 0


def test_cannot_message_self_or_missing_user(client: TestClient, alice: dict, alice_headers: dict[str, str]) -> None:
    self_message = client.post(
        "/api/community/messages",
        headers=alice_headers,
        json={"recipientId": alice["user"]["id"], "body": "hello"},
    )
    assert self_message.status_code == 400
    assert self_message.json()["error"]["code"] == "SELF_MESSAGE"

    missing = client.post(
        "/api/community/messages",
        headers=alice_headers,
        json={"recipientId": "00000000-0000-0000-0000-000000000000", "body": "hello"},
    )
    assert missing.status_code == 404


def test_history_pagination_and_read_watermark(client, alice, alice_headers):
    from datetime import timedelta
    from app.core.time import utcnow
    from app.db.models.chat import ChatMessage
    bob = register_user(client, username="bob", email="bob@example.com")
    bob_headers = {"Authorization": f"Bearer {bob['accessToken']}"}
    with client.app.state.database.session_factory() as session:
        now = utcnow()
        session.add_all([ChatMessage(sender_id=alice["user"]["id"], recipient_id=bob["user"]["id"], body=f"message {i}", created_at=now + timedelta(microseconds=i)) for i in range(81)])
        session.commit()
    path = f"/api/community/messages/{alice['user']['id']}"
    latest = client.get(path, headers=bob_headers).json()
    assert len(latest) == 80
    assert client.get("/api/community/conversations", headers=bob_headers).json()[0]["unreadCount"] == 0
    earlier = client.get(path, params={"before_id": latest[0]["id"]}, headers=bob_headers).json()
    assert len(earlier) == 1
    assert earlier[0]["body"] == "message 0"
    assert not ({item["id"] for item in latest} & {item["id"] for item in earlier})
    # A cursor from somebody else's conversation cannot expose message history.
    outsider = register_user(client, username="charlie", email="charlie@example.com")
    response = client.get(f"/api/community/messages/{outsider['user']['id']}", params={"before_id": latest[0]["id"]}, headers=alice_headers)
    assert response.status_code == 404


def test_message_cursor_has_deterministic_order_for_equal_timestamps(client, alice, alice_headers):
    from app.core.time import utcnow
    from app.db.models.chat import ChatMessage
    bob = register_user(client, username="bob", email="bob@example.com")
    with client.app.state.database.session_factory() as session:
        now = utcnow()
        session.add_all([ChatMessage(id=f"00000000-0000-0000-0000-{i:012d}", sender_id=alice["user"]["id"], recipient_id=bob["user"]["id"], body=str(i), created_at=now) for i in range(3)])
        session.commit()
    path = f"/api/community/messages/{bob['user']['id']}"
    latest = client.get(path, params={"limit": 2}, headers=alice_headers).json()
    earlier = client.get(path, params={"limit": 2, "before_id": latest[0]["id"]}, headers=alice_headers).json()
    assert [m["body"] for m in earlier + latest] == ["0", "1", "2"]
