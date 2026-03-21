"""
pytest test suite for the PeerPrep Question Service (main.py).

Run with:
    pip install pytest pytest-asyncio httpx anyio
    pytest test_main.py -v

pytest.ini (or pyproject.toml) should contain:
    [pytest]
    asyncio_mode = auto
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import AsyncClient, ASGITransport
from pymongo.errors import PyMongoError
from bson import ObjectId

from main import app


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

VALID_ID = "507f1f77bcf86cd799439011"

@pytest.fixture
def create_payload():
    """Payload for POST /create — no version field."""
    return {
        "title": "Two Sum",
        "description": "Given an array of integers, return indices of the two numbers that add up to a target.",
        "topics": ["Arrays", "HashMaps"],
        "difficulty": "Easy",
        "hints": ["Try using a hash map for O(n) time."],
        "model_answer_code": "def twoSum(nums, target): ...",
        "model_answer_lang": "py",
    }


@pytest.fixture
def update_payload():
    """Payload for PUT /update/{id} — version is required."""
    return {
        "title": "Two Sum",
        "description": "Given an array of integers, return indices of the two numbers that add up to a target.",
        "topics": ["Arrays", "HashMaps"],
        "difficulty": "Easy",
        "hints": ["Try using a hash map for O(n) time."],
        "model_answer_code": "def twoSum(nums, target): ...",
        "model_answer_lang": "py",
        "version": 1,
    }


@pytest.fixture
def delete_payload():
    return {"title": "Two Sum"}


@pytest.fixture
def auth_headers():
    return {"Authorization": "Bearer dev-token"}


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


# ---------------------------------------------------------------------------
# POST /create
# ---------------------------------------------------------------------------

class TestCreate:
    @pytest.mark.asyncio
    async def test_creates_new_question(self, client, create_payload, auth_headers):
        mock_result = MagicMock()
        mock_result.inserted_id = ObjectId(VALID_ID)
        with patch("main.questions_col") as mock_col:
            mock_col.find_one = AsyncMock(return_value=None)
            mock_col.insert_one = AsyncMock(return_value=mock_result)
            response = await client.post("/create", json=create_payload, headers=auth_headers)

        assert response.status_code == 201
        body = response.json()
        assert body["status"] == "created"
        assert body["title"] == "Two Sum"
        assert body["version"] == 1
        assert body["id"] == VALID_ID

    @pytest.mark.asyncio
    async def test_returns_409_when_title_already_exists(self, client, create_payload, auth_headers):
        with patch("main.questions_col") as mock_col:
            mock_col.find_one = AsyncMock(return_value={"title": "Two Sum"})
            response = await client.post("/create", json=create_payload, headers=auth_headers)

        assert response.status_code == 409

    @pytest.mark.asyncio
    async def test_returns_503_on_db_error(self, client, create_payload, auth_headers):
        with patch("main.questions_col") as mock_col:
            mock_col.find_one = AsyncMock(side_effect=PyMongoError("timeout"))
            response = await client.post("/create", json=create_payload, headers=auth_headers)

        assert response.status_code == 503

    @pytest.mark.asyncio
    async def test_rejects_invalid_difficulty(self, client, create_payload, auth_headers):
        create_payload["difficulty"] = "Impossible"
        response = await client.post("/create", json=create_payload, headers=auth_headers)
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_rejects_invalid_language(self, client, create_payload, auth_headers):
        create_payload["model_answer_lang"] = "ruby"
        response = await client.post("/create", json=create_payload, headers=auth_headers)
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_rejects_title_too_long(self, client, create_payload, auth_headers):
        create_payload["title"] = "x" * 101
        response = await client.post("/create", json=create_payload, headers=auth_headers)
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_rejects_too_many_topics(self, client, create_payload, auth_headers):
        create_payload["topics"] = ["A", "B", "C", "D"]
        response = await client.post("/create", json=create_payload, headers=auth_headers)
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_rejects_missing_title(self, client, create_payload, auth_headers):
        del create_payload["title"]
        response = await client.post("/create", json=create_payload, headers=auth_headers)
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_rejects_oversized_model_answer(self, client, create_payload, auth_headers):
        create_payload["model_answer_code"] = "x" * 1_000_001
        with patch("main.questions_col"):
            response = await client.post("/create", json=create_payload, headers=auth_headers)
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_does_not_require_version_field(self, client, create_payload, auth_headers):
        """CreateQuestionSchema must not require a version field."""
        assert "version" not in create_payload
        mock_result = MagicMock()
        mock_result.inserted_id = ObjectId(VALID_ID)
        with patch("main.questions_col") as mock_col:
            mock_col.find_one = AsyncMock(return_value=None)
            mock_col.insert_one = AsyncMock(return_value=mock_result)
            response = await client.post("/create", json=create_payload, headers=auth_headers)
        assert response.status_code == 201


# ---------------------------------------------------------------------------
# PUT /update/{question_id}
# ---------------------------------------------------------------------------

class TestUpdate:
    @pytest.mark.asyncio
    async def test_updates_existing_question(self, client, update_payload, auth_headers):
        updated_doc = {"_id": ObjectId(VALID_ID), "title": "Two Sum", "version": 2}
        with patch("main.questions_col") as mock_col:
            mock_col.find_one = AsyncMock(return_value=None)  # no title conflict
            mock_col.find_one_and_update = AsyncMock(return_value=updated_doc)
            response = await client.put(f"/update/{VALID_ID}", json=update_payload, headers=auth_headers)

        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "updated"
        assert body["title"] == "Two Sum"
        assert body["version"] == 2

    @pytest.mark.asyncio
    async def test_version_incremented(self, client, update_payload, auth_headers):
        update_payload["version"] = 3
        updated_doc = {"_id": ObjectId(VALID_ID), "title": "Two Sum", "version": 4}
        with patch("main.questions_col") as mock_col:
            mock_col.find_one = AsyncMock(return_value=None)
            mock_col.find_one_and_update = AsyncMock(return_value=updated_doc)
            response = await client.put(f"/update/{VALID_ID}", json=update_payload, headers=auth_headers)

        assert response.json()["version"] == 4

    @pytest.mark.asyncio
    async def test_returns_409_on_version_conflict(self, client, update_payload, auth_headers):
        """find_one_and_update returns None but the doc exists → version mismatch."""
        existing_doc = {"_id": ObjectId(VALID_ID), "title": "Two Sum", "version": 5}
        with patch("main.questions_col") as mock_col:
            mock_col.find_one = AsyncMock(return_value=None)          # no title conflict
            mock_col.find_one_and_update = AsyncMock(return_value=None)
            # second find_one call (inside the None-check branch) returns the doc
            mock_col.find_one = AsyncMock(side_effect=[None, existing_doc])
            response = await client.put(f"/update/{VALID_ID}", json=update_payload, headers=auth_headers)

        assert response.status_code == 409
        assert "Version conflict" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_returns_404_when_id_not_found(self, client, update_payload, auth_headers):
        """find_one_and_update returns None and the doc doesn't exist → 404."""
        with patch("main.questions_col") as mock_col:
            mock_col.find_one = AsyncMock(return_value=None)  # no title conflict, then not found
            mock_col.find_one_and_update = AsyncMock(return_value=None)
            response = await client.put(f"/update/{VALID_ID}", json=update_payload, headers=auth_headers)

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_returns_400_for_invalid_id_format(self, client, update_payload, auth_headers):
        response = await client.put("/update/not-a-valid-id", json=update_payload, headers=auth_headers)
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_returns_409_when_title_taken_by_another_question(self, client, update_payload, auth_headers):
        """Title already belongs to a different document."""
        conflicting_doc = {"_id": ObjectId("aaaaaaaaaaaaaaaaaaaaaaaa"), "title": "Two Sum"}
        with patch("main.questions_col") as mock_col:
            mock_col.find_one = AsyncMock(return_value=conflicting_doc)
            response = await client.put(f"/update/{VALID_ID}", json=update_payload, headers=auth_headers)

        assert response.status_code == 409
        assert "already exists" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_allows_same_title_on_same_document(self, client, update_payload, auth_headers):
        """Updating a doc with its own existing title must not trigger a conflict."""
        updated_doc = {"_id": ObjectId(VALID_ID), "title": "Two Sum", "version": 2}
        with patch("main.questions_col") as mock_col:
            # find_one returns None (no *other* doc has that title)
            mock_col.find_one = AsyncMock(return_value=None)
            mock_col.find_one_and_update = AsyncMock(return_value=updated_doc)
            response = await client.put(f"/update/{VALID_ID}", json=update_payload, headers=auth_headers)

        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_requires_version_field(self, client, update_payload, auth_headers):
        del update_payload["version"]
        response = await client.put(f"/update/{VALID_ID}", json=update_payload, headers=auth_headers)
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_returns_503_on_db_error(self, client, update_payload, auth_headers):
        with patch("main.questions_col") as mock_col:
            mock_col.find_one = AsyncMock(side_effect=PyMongoError("timeout"))
            response = await client.put(f"/update/{VALID_ID}", json=update_payload, headers=auth_headers)
        assert response.status_code == 503

    @pytest.mark.asyncio
    async def test_rejects_oversized_model_answer(self, client, update_payload, auth_headers):
        update_payload["model_answer_code"] = "x" * 1_000_001
        with patch("main.questions_col"):
            response = await client.put(f"/update/{VALID_ID}", json=update_payload, headers=auth_headers)
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_rejects_invalid_difficulty(self, client, update_payload, auth_headers):
        update_payload["difficulty"] = "Impossible"
        response = await client.put(f"/update/{VALID_ID}", json=update_payload, headers=auth_headers)
        assert response.status_code == 422


# ---------------------------------------------------------------------------
# DELETE /delete
# ---------------------------------------------------------------------------

class TestDelete:
    @pytest.mark.asyncio
    async def test_deletes_existing_question(self, client, delete_payload, auth_headers):
        with patch("main.questions_col") as mock_col:
            mock_col.delete_one = AsyncMock(return_value=MagicMock(deleted_count=1))
            response = await client.request("DELETE", "/delete", json=delete_payload, headers=auth_headers)
        assert response.status_code == 200
        assert response.json()["status"] == "deleted"
        assert response.json()["title"] == "Two Sum"

    @pytest.mark.asyncio
    async def test_returns_404_for_missing_question(self, client, delete_payload, auth_headers):
        with patch("main.questions_col") as mock_col:
            mock_col.delete_one = AsyncMock(return_value=MagicMock(deleted_count=0))
            response = await client.request("DELETE", "/delete", json=delete_payload, headers=auth_headers)
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_returns_503_on_db_error(self, client, delete_payload, auth_headers):
        with patch("main.questions_col") as mock_col:
            mock_col.delete_one = AsyncMock(side_effect=PyMongoError("timeout"))
            response = await client.request("DELETE", "/delete", json=delete_payload, headers=auth_headers)
        assert response.status_code == 503

    @pytest.mark.asyncio
    async def test_requires_only_title(self, client, auth_headers):
        with patch("main.questions_col") as mock_col:
            mock_col.delete_one = AsyncMock(return_value=MagicMock(deleted_count=1))
            response = await client.request("DELETE", "/delete", json={"title": "Two Sum"}, headers=auth_headers)
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_rejects_missing_title(self, client, auth_headers):
        response = await client.request("DELETE", "/delete", json={}, headers=auth_headers)
        assert response.status_code == 422


# ---------------------------------------------------------------------------
# GET /fetch
# ---------------------------------------------------------------------------

class TestFetch:
    @pytest.fixture
    def mock_result(self):
        return [{"_id": VALID_ID, "title": "Two Sum", "topics": ["Arrays"], "difficulty": "Easy"}]

    @pytest.mark.asyncio
    async def test_returns_matching_question(self, client, auth_headers, mock_result):
        with patch("main.questions_col") as mock_col:
            mock_cursor = MagicMock()
            mock_cursor.to_list = AsyncMock(return_value=mock_result)
            mock_col.find = MagicMock(return_value=mock_cursor)
            response = await client.get("/fetch?topics=Arrays&difficulty=Easy", headers=auth_headers)
        assert response.status_code == 200
        assert response.json()["title"] == "Two Sum"
        assert isinstance(response.json()["_id"], str)

    @pytest.mark.asyncio
    async def test_returns_404_when_no_results(self, client, auth_headers):
        with patch("main.questions_col") as mock_col:
            mock_cursor = MagicMock()
            mock_cursor.to_list = AsyncMock(return_value=[])
            mock_col.find = MagicMock(return_value=mock_cursor)
            response = await client.get("/fetch?topics=Graphs&difficulty=Hard", headers=auth_headers)
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_rejects_invalid_difficulty(self, client, auth_headers):
        response = await client.get("/fetch?topics=Arrays&difficulty=Extreme", headers=auth_headers)
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_rejects_empty_topics(self, client, auth_headers):
        response = await client.get("/fetch?topics=&difficulty=Easy", headers=auth_headers)
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_accepts_comma_separated_topics(self, client, auth_headers, mock_result):
        with patch("main.questions_col") as mock_col:
            mock_cursor = MagicMock()
            mock_cursor.to_list = AsyncMock(return_value=mock_result)
            mock_col.find = MagicMock(return_value=mock_cursor)
            response = await client.get("/fetch?topics=Arrays,HashMaps&difficulty=Easy", headers=auth_headers)
        assert response.status_code == 200
        call_filter = mock_col.find.call_args[0][0]
        assert "Arrays" in call_filter["topics"]["$in"]
        assert "HashMaps" in call_filter["topics"]["$in"]

    @pytest.mark.asyncio
    async def test_returns_503_on_db_error(self, client, auth_headers):
        with patch("main.questions_col") as mock_col:
            mock_cursor = MagicMock()
            mock_cursor.to_list = AsyncMock(side_effect=PyMongoError("timeout"))
            mock_col.find = MagicMock(return_value=mock_cursor)
            response = await client.get("/fetch?topics=Arrays&difficulty=Easy", headers=auth_headers)
        assert response.status_code == 503


# ---------------------------------------------------------------------------
# GET /questions
# ---------------------------------------------------------------------------

class TestListQuestions:
    @pytest.mark.asyncio
    async def test_returns_paginated_results(self, client):
        mock_data = [
            {"_id": "id1", "title": "Two Sum", "topics": ["Arrays"], "difficulty": "Easy"},
            {"_id": "id2", "title": "Course Schedule", "topics": ["Graphs"], "difficulty": "Medium"},
        ]
        with patch("main.questions_col") as mock_col:
            mock_col.count_documents = AsyncMock(return_value=2)
            mock_cursor = MagicMock()
            mock_cursor.skip.return_value = mock_cursor
            mock_cursor.limit.return_value = mock_cursor
            mock_cursor.to_list = AsyncMock(return_value=mock_data)
            mock_col.find = MagicMock(return_value=mock_cursor)
            response = await client.get("/questions")

        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 2
        assert len(body["data"]) == 2
        assert body["data"][0]["title"] == "Two Sum"
        assert body["hasMore"] is False

    @pytest.mark.asyncio
    async def test_returns_empty_list(self, client):
        with patch("main.questions_col") as mock_col:
            mock_col.count_documents = AsyncMock(return_value=0)
            mock_cursor = MagicMock()
            mock_cursor.skip.return_value = mock_cursor
            mock_cursor.limit.return_value = mock_cursor
            mock_cursor.to_list = AsyncMock(return_value=[])
            mock_col.find = MagicMock(return_value=mock_cursor)
            response = await client.get("/questions")

        assert response.status_code == 200
        assert response.json()["data"] == []

    @pytest.mark.asyncio
    async def test_converts_objectid_to_string(self, client):
        mock_data = [{"_id": VALID_ID, "title": "Test"}]
        with patch("main.questions_col") as mock_col:
            mock_col.count_documents = AsyncMock(return_value=1)
            mock_cursor = MagicMock()
            mock_cursor.skip.return_value = mock_cursor
            mock_cursor.limit.return_value = mock_cursor
            mock_cursor.to_list = AsyncMock(return_value=mock_data)
            mock_col.find = MagicMock(return_value=mock_cursor)
            response = await client.get("/questions")
        assert isinstance(response.json()["data"][0]["_id"], str)

    @pytest.mark.asyncio
    async def test_rejects_invalid_pagination(self, client):
        response = await client.get("/questions?skip=-1&limit=20")
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_rejects_limit_over_100(self, client):
        response = await client.get("/questions?skip=0&limit=101")
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_returns_503_on_db_error(self, client):
        with patch("main.questions_col") as mock_col:
            mock_col.count_documents = AsyncMock(side_effect=PyMongoError("timeout"))
            response = await client.get("/questions")
        assert response.status_code == 503


# ---------------------------------------------------------------------------
# GET /questions/{question_id}
# ---------------------------------------------------------------------------

class TestGetQuestionById:
    @pytest.mark.asyncio
    async def test_returns_question_by_id(self, client):
        mock_doc = {"_id": ObjectId(VALID_ID), "title": "Two Sum", "topics": ["Arrays"], "difficulty": "Easy", "description": "desc"}
        with patch("main.questions_col") as mock_col:
            mock_col.find_one = AsyncMock(return_value=mock_doc)
            response = await client.get(f"/questions/{VALID_ID}")
        assert response.status_code == 200
        assert response.json()["title"] == "Two Sum"
        assert response.json()["description"] == "desc"

    @pytest.mark.asyncio
    async def test_returns_404_for_missing_id(self, client):
        with patch("main.questions_col") as mock_col:
            mock_col.find_one = AsyncMock(return_value=None)
            response = await client.get(f"/questions/{VALID_ID}")
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_returns_400_for_invalid_id_format(self, client):
        response = await client.get("/questions/not-a-valid-objectid")
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_converts_objectid_to_string(self, client):
        mock_doc = {"_id": ObjectId(VALID_ID), "title": "Test"}
        with patch("main.questions_col") as mock_col:
            mock_col.find_one = AsyncMock(return_value=mock_doc)
            response = await client.get(f"/questions/{VALID_ID}")
        assert isinstance(response.json()["_id"], str)

    @pytest.mark.asyncio
    async def test_returns_503_on_db_error(self, client):
        with patch("main.questions_col") as mock_col:
            mock_col.find_one = AsyncMock(side_effect=PyMongoError("timeout"))
            response = await client.get(f"/questions/{VALID_ID}")
        assert response.status_code == 503

class TestHealth:
    @pytest.mark.asyncio
    async def test_returns_ok_when_db_reachable(self, client):
        with patch("main.client") as mock_client:
            mock_client.admin.command = AsyncMock(return_value={"ok": 1})
            response = await client.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"

    @pytest.mark.asyncio
    async def test_returns_503_when_db_unreachable(self, client):
        with patch("main.client") as mock_client:
            mock_client.admin.command = AsyncMock(side_effect=PyMongoError("unreachable"))
            response = await client.get("/health")
        assert response.status_code == 503