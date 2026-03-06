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
from pymongo.errors import PyMongoError, DuplicateKeyError

from main import app


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def valid_question():
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

class TestUpsertCreate:
    @pytest.mark.asyncio
    async def test_creates_new_question(self, client, valid_question, auth_headers):
        with patch("main.questions_col") as mock_col, \
             patch("main.datetime") as mock_dt:
            fixed_now = "2024-01-01T00:00:00+00:00"
            mock_dt.now.return_value.isoformat.return_value = fixed_now
            mock_col.find_one_and_update = AsyncMock(return_value={
                "title": "Two Sum", "version": 2, "created_at": fixed_now,
                "created_by": "admin@cloud-idp.com",
            })

            response = await client.post("/upsert", json=valid_question, headers=auth_headers)

        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "created"
        assert body["title"] == "Two Sum"
        assert body["version"] == 1

    @pytest.mark.asyncio
    async def test_called_with_upsert_true(self, client, valid_question, auth_headers):
        with patch("main.questions_col") as mock_col, \
             patch("main.datetime") as mock_dt:
            fixed_now = "2024-01-01T00:00:00+00:00"
            mock_dt.now.return_value.isoformat.return_value = fixed_now
            mock_col.find_one_and_update = AsyncMock(return_value={
                "title": "Two Sum", "version": 2, "created_at": fixed_now,
            })

            await client.post("/upsert", json=valid_question, headers=auth_headers)

            _, kwargs = mock_col.find_one_and_update.call_args
            assert kwargs.get("upsert") is True

    @pytest.mark.asyncio
    async def test_setOnInsert_contains_audit_fields(self, client, valid_question, auth_headers):
        with patch("main.questions_col") as mock_col, \
             patch("main.datetime") as mock_dt:
            fixed_now = "2024-01-01T00:00:00+00:00"
            mock_dt.now.return_value.isoformat.return_value = fixed_now
            mock_col.find_one_and_update = AsyncMock(return_value={
                "title": "Two Sum", "version": 2, "created_at": fixed_now,
            })

            await client.post("/upsert", json=valid_question, headers=auth_headers)

            update_doc = mock_col.find_one_and_update.call_args[0][1]
            assert "created_at" in update_doc["$setOnInsert"]
            assert "created_by" in update_doc["$setOnInsert"]

class TestUpsertUpdate:
    @pytest.mark.asyncio
    async def test_updates_existing_question(self, client, valid_question, auth_headers):
        with patch("main.questions_col") as mock_col:
            mock_col.find_one_and_update = AsyncMock(return_value={
                "title": "Two Sum", "version": 2,
                "created_at": "2023-06-01T00:00:00+00:00",  # != now -> was_inserted = False
            })

            response = await client.post("/upsert", json=valid_question, headers=auth_headers)

        assert response.status_code == 200
        assert response.json()["status"] == "updated"
        assert response.json()["version"] == 2

    @pytest.mark.asyncio
    async def test_version_incremented_on_update(self, client, valid_question, auth_headers):
        with patch("main.questions_col") as mock_col:
            mock_col.find_one_and_update = AsyncMock(return_value={
                "title": "Two Sum", "version": 4,
                "created_at": "2023-06-01T00:00:00+00:00",
            })

            valid_question["version"] = 3
            response = await client.post("/upsert", json=valid_question, headers=auth_headers)

        assert response.json()["version"] == 4

class TestUpsertConflict:
    @pytest.mark.asyncio
    async def test_returns_409_on_duplicate_key(self, client, valid_question, auth_headers):
        with patch("main.questions_col") as mock_col:
            mock_col.find_one_and_update = AsyncMock(side_effect=DuplicateKeyError("dup"))
            response = await client.post("/upsert", json=valid_question, headers=auth_headers)
        assert response.status_code == 409

    @pytest.mark.asyncio
    async def test_returns_409_on_pymongo_error(self, client, valid_question, auth_headers):
        with patch("main.questions_col") as mock_col:
            mock_col.find_one_and_update = AsyncMock(side_effect=PyMongoError("connection reset"))
            response = await client.post("/upsert", json=valid_question, headers=auth_headers)
        assert response.status_code == 409

class TestUpsertValidation:
    @pytest.mark.asyncio
    async def test_rejects_invalid_difficulty(self, client, valid_question, auth_headers):
        valid_question["difficulty"] = "Impossible"
        response = await client.post("/upsert", json=valid_question, headers=auth_headers)
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_rejects_invalid_language(self, client, valid_question, auth_headers):
        valid_question["model_answer_lang"] = "ruby"
        response = await client.post("/upsert", json=valid_question, headers=auth_headers)
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_rejects_title_too_long(self, client, valid_question, auth_headers):
        valid_question["title"] = "x" * 101
        response = await client.post("/upsert", json=valid_question, headers=auth_headers)
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_rejects_too_many_topics(self, client, valid_question, auth_headers):
        valid_question["topics"] = ["A", "B", "C", "D"]
        response = await client.post("/upsert", json=valid_question, headers=auth_headers)
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_rejects_oversized_model_answer(self, client, valid_question, auth_headers):
        valid_question["model_answer_code"] = "x" * 1_000_001
        with patch("main.questions_col"):
            response = await client.post("/upsert", json=valid_question, headers=auth_headers)
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_rejects_missing_title(self, client, valid_question, auth_headers):
        del valid_question["title"]
        response = await client.post("/upsert", json=valid_question, headers=auth_headers)
        assert response.status_code == 422

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

class TestFetch:
    @pytest.fixture
    def mock_result(self):
        return [{"_id": "507f1f77bcf86cd799439011", "title": "Two Sum", "topics": ["Arrays"], "difficulty": "Easy"}]

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