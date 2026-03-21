import os
import random
import logging
import motor.motor_asyncio
from bson import ObjectId
from bson.errors import InvalidId
from typing import Optional, List
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, Field, field_validator
from pymongo import ReturnDocument
from pymongo.errors import PyMongoError

app = FastAPI(title="PeerPrep Question Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

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

class CreateQuestionSchema(BaseModel):
    title: str = Field(..., max_length=100)
    description: str = Field(..., max_length=2000)
    topics: List[str] = Field(..., max_items=3)
    hints: List[str] = Field(default=[], max_items=3)
    difficulty: str
    model_answer_code: Optional[str] = None
    model_answer_lang: Optional[str] = None

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

class UpdateQuestionSchema(CreateQuestionSchema):
    version: int = Field(..., description="Current version of the document for optimistic locking")

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


@app.post("/create", status_code=201)
async def create_question(
    qn: CreateQuestionSchema,
    admin_email: str = Depends(get_current_admin),
):
    """
    Creates a new question. Returns 409 Conflict if a question with the same title already exists.
    """
    if qn.model_answer_code and len(qn.model_answer_code.encode()) > 1_000_000:
        raise HTTPException(status_code=400, detail="Model answer code exceeds 1 MB")

    now = datetime.now(timezone.utc).isoformat()
    data = qn.model_dump()

    doc = {
        **data,
        "version": 1,
        "created_at": now,
        "created_by": admin_email,
        "updated_at": now,
        "updated_by": admin_email,
    }

    try:
        existing = await questions_col.find_one({"title": data["title"]})
        if existing:
            raise HTTPException(status_code=409, detail=f"Question '{data['title']}' already exists.")
        result = await questions_col.insert_one(doc)
    except HTTPException:
        raise
    except PyMongoError as exc:
        logger.error("MongoDB error during create for '%s': %s", data["title"], exc)
        raise HTTPException(status_code=503, detail="Database unavailable, please retry later") from exc

    logger.info("Created new question '%s' by %s", data["title"], admin_email)
    return {"status": "created", "title": data["title"], "id": str(result.inserted_id), "version": 1}


@app.put("/update/{question_id}", status_code=200)
async def update_question(
    question_id: str,
    qn: UpdateQuestionSchema,
    admin_email: str = Depends(get_current_admin),
):
    """
    Updates an existing question by ID with optimistic locking.
    The request body must include the current `version` number.
    Returns 409 Conflict if the version doesn't match (i.e. a concurrent update occurred).
    Returns 404 if no question with the given ID is found.
    """

    if qn.model_answer_code and len(qn.model_answer_code.encode()) > 1_000_000:
        raise HTTPException(status_code=400, detail="Model answer code exceeds 1 MB")

    try:
        obj_id = ObjectId(question_id)
    except InvalidId:
        raise HTTPException(status_code=400, detail=f"Invalid question ID format: '{question_id}'")

    now = datetime.now(timezone.utc).isoformat()
    data = qn.model_dump()
    current_version = data.pop("version")

    # Ensure no other document already holds the new title
    try:
        title_conflict = await questions_col.find_one({"title": data["title"], "_id": {"$ne": obj_id}})
    except PyMongoError as exc:
        logger.error("MongoDB error during title conflict check for '%s': %s", data["title"], exc)
        raise HTTPException(status_code=503, detail="Database unavailable, please retry later") from exc

    if title_conflict:
        raise HTTPException(status_code=409, detail=f"Another question with title '{data['title']}' already exists.")

    set_fields = {
        **data,
        "updated_at": now,
        "updated_by": admin_email,
        "version": current_version + 1,
    }

    try:
        doc = await questions_col.find_one_and_update(
            {"_id": obj_id, "version": current_version},
            {"$set": set_fields},
            return_document=ReturnDocument.AFTER,
        )
    except PyMongoError as exc:
        logger.error("MongoDB error during update for id '%s': %s", question_id, exc)
        raise HTTPException(status_code=503, detail="Database unavailable, please retry later") from exc

    if doc is None:
        # Distinguish between not found and version mismatch
        try:
            exists = await questions_col.find_one({"_id": obj_id})
        except PyMongoError:
            exists = None

        if not exists:
            raise HTTPException(status_code=404, detail=f"Question with ID '{question_id}' not found.")
        raise HTTPException(
            status_code=409,
            detail=f"Version conflict — document is at version {exists.get('version')}, but version {current_version} was provided. Re-fetch and retry.",
        )

    logger.info("Updated question id '%s' → version %d by %s", question_id, current_version + 1, admin_email)
    return {"status": "updated", "id": question_id, "title": doc.get("title"), "version": current_version + 1}

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


@app.get("/questions")
async def list_questions(skip: int = 0, limit: int = 20):
    """Returns paginated questions from the database."""
    if skip < 0 or limit < 1 or limit > 100:
        raise HTTPException(status_code=400, detail="Invalid pagination parameters. limit must be 1-100, skip must be >= 0")
    
    try:
        total = await questions_col.count_documents({})
        cursor = questions_col.find({}).skip(skip).limit(limit)
        results = await cursor.to_list(length=limit)
    except PyMongoError as exc:
        logger.error("MongoDB query failed: %s", exc)
        raise HTTPException(status_code=503, detail="Database unavailable, please retry later") from exc

    for r in results:
        r["_id"] = str(r["_id"])
    return {
        "data": results,
        "total": total,
        "skip": skip,
        "limit": limit,
        "hasMore": skip + limit < total
    }


@app.get("/questions/{title}")
async def get_question_by_title(title: str):
    """Returns a single question by its exact title."""
    try:
        doc = await questions_col.find_one({"title": title})
    except PyMongoError as exc:
        logger.error("MongoDB query failed for '%s': %s", title, exc)
        raise HTTPException(status_code=503, detail="Database unavailable, please retry later") from exc

    if not doc:
        raise HTTPException(status_code=404, detail=f"Question '{title}' not found")
    doc["_id"] = str(doc["_id"])
    return doc


@app.get("/health")
async def health_check():
    """Liveness probe for Docker / Kubernetes."""
    try:
        await client.admin.command("ping")
    except PyMongoError as exc:
        logger.error("Health check failed: %s", exc)
        raise HTTPException(status_code=503, detail="Database unreachable") from exc
    return {"status": "ok"}