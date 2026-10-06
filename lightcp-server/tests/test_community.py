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
