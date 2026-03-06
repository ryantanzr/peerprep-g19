import os
import random
import logging
import motor.motor_asyncio
from typing import Optional, List
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException, Depends
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, Field, field_validator
from pymongo import ReturnDocument
from pymongo.errors import PyMongoError

app = FastAPI(title="PeerPrep Question Service")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("question_service")

MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")

if not MONGO_URL:
    raise EnvironmentError("MONGO_URL environment variable must be set.")

client = motor.motor_asyncio.AsyncIOMotorClient(MONGO_URL, serverSelectionTimeoutMS=5000)
db = client.peerprep_db
questions_col = db.questions

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

class QuestionSchema(BaseModel):
    title: str = Field(..., max_length=100)
    description: str = Field(..., max_length=2000)
    topics: List[str] = Field(..., max_items=3)
    hints: List[str] = Field(default=[], max_items=3)
    difficulty: str
    model_answer_code: Optional[str] = None
    model_answer_lang: Optional[str] = None
    version: int = Field(default=1)

    @field_validator('difficulty', mode='before')
    def validate_difficulty(cls, v):
        if v and v not in ('Easy', 'Medium', 'Hard'):
            raise ValueError('Invalid Difficulty for question')
        return v

    @field_validator('topics', mode='before')
    def validate_topics(cls, v):
        for t in v:
            if len(t) > 50:
                raise ValueError("Topic too long (max 50)")
        return v

    @field_validator('model_answer_lang', mode='before')
    def validate_lang(cls, v):
        if v and v not in ('cpp', 'java', 'py', 'c'):
            raise ValueError("Invalid language for model answer")
        return v

class DeleteRequest(BaseModel):
    title: str = Field(..., max_length=100)

async def get_current_admin(token: str = Depends(oauth2_scheme)):
    """
    Integrate Google/AWS token verification here.
    Returns the user identifier (email/sub) if they have the 'Admin' role.
    """
    # Pseudo-code for Cloud IDP verification:
    # decoded_token = verify_cloud_jwt(token)
    # if "Admin" not in decoded_token['roles']: raise 403
    # return decoded_token['email']
    return "admin@cloud-idp.com"  # Mocked for implementation


@app.post("/upsert", status_code=200)
async def upsert_question(
    qn: QuestionSchema,
    admin_email: str = Depends(get_current_admin),
):
    """
    Upserts a question directly into MongoDB with optimistic locking.
    - If no document with the given title exists, inserts a new one.
    - If a matching title is found, update the updated_at field.
    - If the title exists but the version doesn't match, rejects with 409 Conflict.
    """
    if qn.model_answer_code and len(qn.model_answer_code.encode()) > 1_000_000:
        raise HTTPException(status_code=400, detail="Model answer code exceeds 1 MB")

    data = qn.model_dump()
    title = data["title"]
    version = data.get("version", 1)
    now = datetime.now(timezone.utc).isoformat()

    set_fields = {k: v for k, v in data.items() if k != "title"}
    set_fields.update({"updated_at": now, "updated_by": admin_email, "version": version + 1})

    try:
        doc = await questions_col.find_one_and_update(
            {"title": title, "version": version},
            {
                "$set": set_fields,
                "$setOnInsert": {"created_at": now, "created_by": admin_email, "title": title},
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
    except PyMongoError as exc:
        logger.error("MongoDB error during upsert for '%s': %s", title, exc)
        raise HTTPException(status_code=409, detail="Write conflict — re-fetch the document and retry.") from exc

    was_inserted = doc.get("created_at") == now
    if was_inserted:
        logger.info("Created new question '%s'", title)
        return {"status": "created", "title": title, "version": 1}

    logger.info("Updated '%s' → version %d", title, version + 1)
    return {"status": "updated", "title": title, "version": version + 1}

@app.delete("/delete", status_code=200)
async def delete_question(
    req: DeleteRequest,
    admin_email: str = Depends(get_current_admin),
):
    """Deletes a question by title. Returns 404 if no matching document is found."""
    try:
        result = await questions_col.delete_one({"title": req.title})
    except PyMongoError as exc:
        logger.error("MongoDB error during delete for '%s': %s", req.title, exc)
        raise HTTPException(status_code=503, detail="Database unavailable, please retry later") from exc

    if result.deleted_count == 0:
        logger.warning("Delete requested for '%s' but no document found.", req.title)
        raise HTTPException(status_code=404, detail=f"Question '{req.title}' not found.")

    logger.info("Deleted question '%s' by %s", req.title, admin_email)
    return {"status": "deleted", "title": req.title}

@app.get("/fetch")
async def fetch_question(topics: str, difficulty: str):
    """
    Fetches a random matching question directly from MongoDB.
    `topics` is a comma-separated string e.g. ?topics=arrays,graphs
    """
    if difficulty not in ("Easy", "Medium", "Hard"):
        raise HTTPException(status_code=400, detail="difficulty must be one of: Easy, Medium, Hard")

    topic_list = [t.strip() for t in topics.split(",") if t.strip()]
    if not topic_list:
        raise HTTPException(status_code=400, detail="At least one topic must be provided")

    mongo_filter = {"topics": {"$in": topic_list}, "difficulty": difficulty}

    try:
        cursor = questions_col.find(mongo_filter)
        results = await cursor.to_list(length=50)
    except PyMongoError as exc:
        logger.error("MongoDB query failed: %s", exc)
        raise HTTPException(status_code=503, detail="Database unavailable, please retry later") from exc

    if not results:
        raise HTTPException(status_code=404, detail="No matching questions found")

    choice = random.choice(results)
    choice["_id"] = str(choice["_id"])
    return choice


@app.get("/health")
async def health_check():
    """Liveness probe for Docker / Kubernetes."""
    try:
        await client.admin.command("ping")
    except PyMongoError as exc:
        logger.error("Health check failed: %s", exc)
        raise HTTPException(status_code=503, detail="Database unreachable") from exc
    return {"status": "ok"}