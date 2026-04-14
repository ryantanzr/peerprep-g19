import os
import re
import base64
import random
import logging
import motor.motor_asyncio
import firebase_admin
from firebase_admin import credentials, auth as firebase_auth
from bson import ObjectId
from bson.errors import InvalidId
from typing import Optional, List
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, Field, field_validator
from pymongo import ReturnDocument, ASCENDING
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

MONGO_URL = os.getenv("QN_SERVICE_CLOUD_URI", "mongodb://localhost:27017")

if not MONGO_URL:
    raise EnvironmentError("QN_SERVICE_CLOUD_URI environment variable must be set.")

client = motor.motor_asyncio.AsyncIOMotorClient(MONGO_URL, serverSelectionTimeoutMS=5000)
db = client.peerprep_db
questions_col = db.questions

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# Initialize Firebase Admin SDK
try:
    FIREBASE_SERVICE_KEY = os.getenv("FIREBASE_SERVICE_KEY")
    if FIREBASE_SERVICE_KEY:
        import json
        cred = credentials.Certificate(json.loads(FIREBASE_SERVICE_KEY))
        firebase_admin.initialize_app(cred)
    elif os.getenv("FIREBASE_PROJECT_ID") and os.getenv("FIREBASE_CLIENT_EMAIL") and os.getenv("FIREBASE_PRIVATE_KEY"):
        cred = credentials.Certificate({
            "type": "service_account",
            "project_id": os.getenv("FIREBASE_PROJECT_ID"),
            "client_email": os.getenv("FIREBASE_CLIENT_EMAIL"),
            "private_key": os.getenv("FIREBASE_PRIVATE_KEY", "").replace("\\n", "\n"),
            "token_uri": "https://oauth2.googleapis.com/token",
        })
        firebase_admin.initialize_app(cred)
    else:
        logger.warning("No Firebase credentials configured — admin auth will reject all requests")
except Exception as exc:
    logger.error("Failed to initialize Firebase Admin SDK: %s", exc)
    logger.warning("Admin auth will reject all requests")

MAX_IMAGE_SIZE_BYTES = 4 * 1024 * 1024  # 4 MB
MAX_IMAGES = 3
VALID_DIFFICULTIES = ("Easy", "Medium", "Hard")


class CreateQuestionSchema(BaseModel):
    title: str = Field(..., max_length=100)
    description: str = Field(..., max_length=2000)
    topics: List[str] = Field(..., max_length=3)
    hints: List[str] = Field(default=[], max_length=3)
    difficulty: str
    model_answer_code: Optional[str] = None
    model_answer_lang: Optional[str] = None
    images: List[str] = Field(default=[], description="Base64-encoded images, max 3, each up to 4 MB")

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


async def get_current_user(token: str = Depends(oauth2_scheme)):
    """
    Verifies Firebase ID token only. Any authenticated user can access.
    Returns the user's uid/email.
    """
    if not firebase_admin._apps:
        raise HTTPException(status_code=503, detail="Authentication service not configured")
    try:
        decoded = firebase_auth.verify_id_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    return decoded.get("email", decoded.get("uid"))


async def get_current_admin(token: str = Depends(oauth2_scheme)):
    """
    Verifies Firebase ID token and checks for admin role via custom claims.
    Returns the user's email if they have the 'admin' role.
    """
    if not firebase_admin._apps:
        raise HTTPException(status_code=503, detail="Authentication service not configured")
    try:
        decoded = firebase_auth.verify_id_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    if decoded.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    return decoded.get("email", decoded.get("uid"))


def validate_images(images: list[str]) -> None:
    """Raises HTTPException if image list exceeds count or per-image size limits."""
    if len(images) > MAX_IMAGES:
        raise HTTPException(status_code=400, detail=f"Too many images — maximum {MAX_IMAGES} allowed.")
    for i, img in enumerate(images):
        raw = img.split(",", 1)[-1] if img.startswith("data:") else img
        try:
            decoded_size = len(base64.b64decode(raw, validate=True))
        except Exception:
            raise HTTPException(status_code=400, detail=f"Image {i + 1} is not valid base64.")
        if decoded_size > MAX_IMAGE_SIZE_BYTES:
            raise HTTPException(status_code=400, detail=f"Image {i + 1} exceeds the 4 MB limit.")


@app.on_event("startup")
async def create_indexes():
    await questions_col.create_index([("title", ASCENDING)])
    await questions_col.create_index([("difficulty", ASCENDING)])
    await questions_col.create_index([("topics", ASCENDING)])


@app.post("/create", status_code=201)
async def create_question(
    qn: CreateQuestionSchema,
    admin_email: str = Depends(get_current_admin),
):
    """Creates a new question. Returns 409 Conflict if a question with the same title already exists."""
    if qn.model_answer_code and len(qn.model_answer_code.encode()) > 1_000_000:
        raise HTTPException(status_code=400, detail="Model answer code exceeds 1 MB")
    validate_images(qn.images)

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
    """Updates an existing question by ID with optimistic locking."""
    if qn.model_answer_code and len(qn.model_answer_code.encode()) > 1_000_000:
        raise HTTPException(status_code=400, detail="Model answer code exceeds 1 MB")
    validate_images(qn.images)

    try:
        obj_id = ObjectId(question_id)
    except InvalidId:
        raise HTTPException(status_code=400, detail=f"Invalid question ID format: '{question_id}'")

    now = datetime.now(timezone.utc).isoformat()
    data = qn.model_dump()
    current_version = data.pop("version")

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
async def fetch_question(topics: str, difficulty: str, _: str = Depends(get_current_user)):
    """
    Fetches a random matching question directly from MongoDB.
    `topics` is a comma-separated string e.g. ?topics=arrays,graphs
    """
    if difficulty not in VALID_DIFFICULTIES:
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


@app.get("/questions/stats")
async def question_stats(_: str = Depends(get_current_admin)):
    """Returns aggregate stats: total count, difficulty breakdown, and unique topics."""
    try:
        pipeline = [
            {
                "$facet": {
                    "difficulty_counts": [
                        {"$group": {"_id": "$difficulty", "count": {"$sum": 1}}}
                    ],
                    "topics": [
                        {"$unwind": "$topics"},
                        {"$group": {"_id": "$topics"}},
                        {"$sort": {"_id": 1}},
                    ],
                    "total": [{"$count": "count"}],
                }
            }
        ]
        cursor = questions_col.aggregate(pipeline)
        result = await cursor.to_list(length=1)
    except PyMongoError as exc:
        logger.error("MongoDB aggregation failed: %s", exc)
        raise HTTPException(status_code=503, detail="Database unavailable, please retry later") from exc

    facets = result[0] if result else {"difficulty_counts": [], "topics": [], "total": []}
    total = facets["total"][0]["count"] if facets["total"] else 0
    difficulty_counts = {item["_id"]: item["count"] for item in facets["difficulty_counts"]}
    topics = [item["_id"] for item in facets["topics"]]

    return {
        "total": total,
        "difficulty_counts": difficulty_counts,
        "topics": topics,
    }


@app.get("/questions")
async def list_questions(
    skip: int = 0,
    limit: int = 20,
    search: Optional[str] = None,
    difficulty: Optional[str] = None,
    topic: Optional[str] = None,
    _: str = Depends(get_current_user),
):
    """Returns paginated, filterable questions."""
    if skip < 0 or limit < 1 or limit > 100:
        raise HTTPException(status_code=400, detail="Invalid pagination parameters. limit must be 1-100, skip must be >= 0")
    if difficulty and difficulty not in VALID_DIFFICULTIES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid difficulty '{difficulty}'. Must be one of: Easy, Medium, Hard",
        )

    mongo_filter: dict = {}
    if search:
        mongo_filter["title"] = {"$regex": re.escape(search), "$options": "i"}
    if difficulty:
        mongo_filter["difficulty"] = difficulty
    if topic:
        mongo_filter["topics"] = topic

    try:
        total = await questions_col.count_documents(mongo_filter)
        cursor = questions_col.find(mongo_filter).sort("title", ASCENDING).skip(skip).limit(limit)
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
        "hasMore": skip + limit < total,
    }


@app.get("/questions/{question_id}")
async def get_question_by_id(question_id: str, _: str = Depends(get_current_user)):
    """Returns a single question by its ObjectId or title."""
    # Handle double URL encoding bug
    import urllib.parse
    question_id = urllib.parse.unquote(question_id)
    
    try:
        # Try ObjectId first, fall back to title lookup
        try:
            obj_id = ObjectId(question_id)
            doc = await questions_col.find_one({"_id": obj_id})
        except InvalidId:
            doc = await questions_col.find_one({"title": question_id})
    except PyMongoError as exc:
        logger.error("MongoDB query failed for '%s': %s", question_id, exc)
        raise HTTPException(status_code=503, detail="Database unavailable, please retry later") from exc

    if not doc:
        raise HTTPException(status_code=404, detail=f"Question '{question_id}' not found")
    doc["_id"] = str(doc["_id"])
    return doc


@app.get("/topics")
async def get_all_topics(search: Optional[str] = None, _: str = Depends(get_current_user)):
    """Returns sorted list of all unique topics across all questions. Supports optional case-insensitive search filter."""
    try:
        pipeline = [
            {"$unwind": "$topics"},
            {"$group": {"_id": "$topics"}},
        ]
        
        if search:
            pipeline.append({
                "$match": {
                    "_id": {
                        "$regex": re.escape(search),
                        "$options": "i"
                    }
                }
            })
            
        pipeline.append({"$sort": {"_id": 1}})
        
        cursor = questions_col.aggregate(pipeline)
        result = await cursor.to_list(length=500)
    except PyMongoError as exc:
        logger.error("MongoDB aggregation failed: %s", exc)
        raise HTTPException(status_code=503, detail="Database unavailable, please retry later") from exc

    return [item["_id"] for item in result]


@app.get("/health")
async def health_check():
    """Liveness probe for Docker / Kubernetes."""
    try:
        await client.admin.command("ping")
    except PyMongoError as exc:
        logger.error("Health check failed: %s", exc)
        raise HTTPException(status_code=503, detail="Database unreachable") from exc
    return {"status": "ok"}
