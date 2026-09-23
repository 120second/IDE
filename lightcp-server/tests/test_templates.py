from fastapi.testclient import TestClient


def template_payload(**overrides) -> dict:
    value = {
        "kind": "snippet",
        "name": "Binary Search",
        "trigger": "bsearch",
        "aliases": ["binary", "二分"],
        "description": "Binary search template",
        "language": "cpp",
        "categoryId": None,
        "favorite": False,
        "sortOrder": 0,
        "code": "int lower_bound_custom() { return 0; }",
    }
    value.update(overrides)
    return value


def test_template_and_nested_category_crud(client: TestClient, alice_headers: dict[str, str]) -> None:
    parent = client.post(
        "/api/template-categories",
        headers=alice_headers,
        json={"name": "Algorithms", "sortOrder": 0},
    )
    assert parent.status_code == 201
    child = client.post(
        "/api/template-categories",
        headers=alice_headers,
        json={"name": "Search", "parentId": parent.json()["id"], "sortOrder": 0},
    )
    assert child.status_code == 201

    created = client.post(
        "/api/templates",
        headers=alice_headers,
        json=template_payload(categoryId=child.json()["id"]),
    )
    assert created.status_code == 201
    template_id = created.json()["id"]

    listed = client.get("/api/templates?kind=snippet&search=binary", headers=alice_headers)
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [template_id]

    # Selecting a parent category includes templates in all nested categories,
    # matching the original LightCP local template behavior.
    parent_list = client.get(
        f"/api/templates?kind=snippet&category_id={parent.json()['id']}",
        headers=alice_headers,
    )
    assert parent_list.status_code == 200
    assert [item["id"] for item in parent_list.json()] == [template_id]

    child_list = client.get(
        f"/api/templates?kind=snippet&category_id={child.json()['id']}",
        headers=alice_headers,
    )
    assert child_list.status_code == 200
    assert [item["id"] for item in child_list.json()] == [template_id]

    updated_payload = template_payload(
        name="Binary Search Updated",
        favorite=True,
        categoryId=child.json()["id"],
        code="updated code",
    )
    updated = client.put(
        f"/api/templates/{template_id}", headers=alice_headers, json=updated_payload
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Binary Search Updated"
    assert updated.json()["code"] == "updated code"

    used = client.post(f"/api/templates/{template_id}/use", headers=alice_headers)
    assert used.status_code == 204
    fetched = client.get(f"/api/templates/{template_id}", headers=alice_headers)
    assert fetched.json()["useCount"] == 1
    assert fetched.json()["lastUsed"] is not None

    deleted = client.delete(f"/api/templates/{template_id}", headers=alice_headers)
    assert deleted.status_code == 204
    assert client.get(f"/api/templates/{template_id}", headers=alice_headers).status_code == 404


def test_users_cannot_access_each_others_templates(
    client: TestClient,
    alice_headers: dict[str, str],
) -> None:
    created = client.post("/api/templates", headers=alice_headers, json=template_payload())
    template_id = created.json()["id"]

    bob = client.post(
        "/api/auth/register",
        json={
            "username": "bob",
            "email": "bob@example.com",
            "password": "another-correct-password",
        },
    ).json()
    bob_headers = {"Authorization": f"Bearer {bob['accessToken']}"}

    assert client.get(f"/api/templates/{template_id}", headers=bob_headers).status_code == 404
    assert client.put(
        f"/api/templates/{template_id}", headers=bob_headers, json=template_payload()
    ).status_code == 404
    assert client.delete(f"/api/templates/{template_id}", headers=bob_headers).status_code == 404
    bob_templates = client.get("/api/templates", headers=bob_headers).json()
    assert len(bob_templates) == 3
    assert template_id not in {item["id"] for item in bob_templates}


def test_user_cannot_attach_template_to_another_users_category(
    client: TestClient,
    alice_headers: dict[str, str],
) -> None:
    category = client.post(
        "/api/template-categories",
        headers=alice_headers,
        json={"name": "Private", "sortOrder": 0},
    ).json()
    bob = client.post(
        "/api/auth/register",
        json={
            "username": "bob",
            "email": "bob@example.com",
            "password": "another-correct-password",
        },
    ).json()
    bob_headers = {"Authorization": f"Bearer {bob['accessToken']}"}

    response = client.post(
        "/api/templates",
        headers=bob_headers,
        json=template_payload(categoryId=category["id"]),
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "CATEGORY_NOT_FOUND"


def test_nested_category_cycle_is_rejected(
    client: TestClient,
    alice_headers: dict[str, str],
) -> None:
    parent = client.post(
        "/api/template-categories",
        headers=alice_headers,
        json={"name": "Parent", "sortOrder": 0},
    ).json()
    child = client.post(
        "/api/template-categories",
        headers=alice_headers,
        json={"name": "Child", "parentId": parent["id"], "sortOrder": 0},
    ).json()

    response = client.put(
        f"/api/template-categories/{parent['id']}",
        headers=alice_headers,
        json={"name": "Parent", "parentId": child["id"], "sortOrder": 0},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_CATEGORY_PARENT"
