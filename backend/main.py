# without auth
# from __future__ import annotations

# import os
# import time
# from datetime import datetime, timezone
# from pathlib import Path
# from uuid import uuid4

# import certifi
# import cv2
# from fastapi import FastAPI, File, HTTPException, UploadFile
# from fastapi.middleware.cors import CORSMiddleware
# from pydantic import BaseModel, Field
# from pymongo import MongoClient

# # --- Configuration ---
# UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "./uploads"))
# UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# MONGO_URI = os.getenv("MONGO_URI", "mongodb+srv://ntekimemmanuelekpo_db_user:D1a6DwYOfhXHsVk2@visualtrackercluster.n37mnmm.mongodb.net/?appName=VisualTrackerCluster")
# MONGO_DATABASE = os.getenv("MONGO_DATABASE", "visualtracker")

# app = FastAPI(title="VisualTracker Studio API", version="1.1.0")
# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=[os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")],
#     allow_methods=["*"],
#     allow_headers=["*"],
# )

# # --- Database Initialization ---
# try:
#     mongo = MongoClient(MONGO_URI, tlsCAFile=certifi.where(), serverSelectionTimeoutMS=5000)
#     mongo.admin.command("ping")
#     sessions = mongo[MONGO_DATABASE]["sessions"]
#     print("Successfully connected to MongoDB Atlas.")
# except Exception as e:
#     print(f"MongoDB connection failed: {e}")
#     mongo = None
#     sessions = None

# # --- Pydantic Models ---
# class TrackRequest(BaseModel):
#     bbox: dict[str, float] = Field(..., description="x, y, width and height in source pixels")
#     trackers: list[str] = Field(min_length=1)

# # --- Helper Functions ---
# def metadata(path: Path) -> dict[str, float | int]:
#     capture = cv2.VideoCapture(str(path))
#     if not capture.isOpened():
#         raise HTTPException(status_code=422, detail="The uploaded file is not a readable video.")

#     values = {
#         "frames": int(capture.get(cv2.CAP_PROP_FRAME_COUNT)),
#         "fps": float(capture.get(cv2.CAP_PROP_FPS) or 0),
#         "width": int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)),
#         "height": int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)),
#     }
#     capture.release()
#     return values

# def clamp_bbox(box: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
#     x, y, w, h = box
#     return (max(0.0, x), max(0.0, y), max(1.0, w), max(1.0, h))

# def tracker_factory(name: str):
#     normalized = name.upper()
#     if normalized == "GOTURN":
#         creator = getattr(cv2, "TrackerKCF_create", None)
#         if creator is None and hasattr(cv2, "legacy"):
#             creator = getattr(cv2.legacy, "TrackerKCF_create", None)
#         return (creator() if creator else None, "simulated")

#     creator = getattr(cv2, f"Tracker{normalized}_create", None)
#     if creator is None and hasattr(cv2, "legacy"):
#         creator = getattr(cv2.legacy, f"Tracker{normalized}_create", None)
#     return (creator() if creator else None, "native")

# # --- API Endpoints ---
# @app.get("/")
# def read_root():
#     return {"message": "Welcome to the VisualTracker Studio API"}

# @app.get("/health")
# def health() -> dict[str, str]:
#     return {"status": "ok", "database": "connected" if sessions is not None else "unavailable"}

# @app.get("/api/sessions")
# def get_sessions():
#     if sessions is None:
#         raise HTTPException(status_code=503, detail="MongoDB Atlas is unavailable.")
    
#     # Retrieve all sessions from Atlas. We exclude 'results.trajectory' to keep the payload lightweight.
#     cursor = sessions.find({}, {"results.trajectory": 0}).sort("created_at", -1)
#     history = []
#     for doc in cursor:
#         doc["id"] = doc.pop("_id")
#         history.append(doc)
#     return history

# @app.post("/api/sessions")
# async def create_session(file: UploadFile = File(...)):
#     if not file.content_type or not file.content_type.startswith("video/"):
#         raise HTTPException(status_code=415, detail="Please upload a video file.")

#     session_id = str(uuid4())
#     path = UPLOAD_DIR / f"{session_id}_{Path(file.filename or 'video').name}"
    
#     with open(path, "wb") as buffer:
#         while content := await file.read(1024 * 1024): 
#             buffer.write(content)
            
#     video = metadata(path)
#     document = {
#         "_id": session_id,
#         "filename": file.filename,
#         "path": str(path),
#         **video,
#         "created_at": datetime.now(timezone.utc),
#     }
#     if sessions is not None:
#         sessions.insert_one(document)

#     return {"id": session_id, "filename": file.filename, **video}

# @app.post("/api/sessions/{session_id}/track")
# def track(session_id: str, request: TrackRequest):
#     if sessions is None:
#         raise HTTPException(status_code=503, detail="MongoDB Atlas is unavailable.")

#     session = sessions.find_one({"_id": session_id})
#     if session is None:
#         raise HTTPException(status_code=404, detail="Tracking session not found.")

#     required = {"x", "y", "width", "height"}
#     if set(request.bbox) != required or any(value < 0 for value in request.bbox.values()) or request.bbox["width"] <= 0 or request.bbox["height"] <= 0:
#         raise HTTPException(status_code=422, detail="Bounding box dimensions must be positive.")

#     capture = cv2.VideoCapture(session["path"])
#     if not capture.isOpened():
#         raise HTTPException(status_code=422, detail="Video could not be opened.")

#     ok, frame0 = capture.read()
#     if not ok:
#         capture.release()
#         raise HTTPException(status_code=422, detail="Video has no readable frames.")

#     frame_height, frame_width = frame0.shape[:2]

#     req_x, req_y, req_w, req_h = [int(request.bbox[k]) for k in ("x", "y", "width", "height")]
#     safe_x = max(0, min(req_x, frame_width - 1))
#     safe_y = max(0, min(req_y, frame_height - 1))
#     safe_w = max(1, min(req_w, frame_width - safe_x))
#     safe_h = max(1, min(req_h, frame_height - safe_y))
#     initial_box_int = (safe_x, safe_y, safe_w, safe_h)

#     active_trackers = {}
#     results = []
    
#     for name in request.trackers:
#         tracker_obj, mode = tracker_factory(name)
#         if tracker_obj is None:
#             results.append({
#                 "tracker": name,
#                 "status": "unsupported",
#                 "note": "Tracker missing from local OpenCV runtime."
#             })
#             continue
            
#         tracker_obj.init(frame0, initial_box_int)
#         active_trackers[name] = {
#             "obj": tracker_obj,
#             "mode": mode,
#             "trajectory": [list(initial_box_int)],
#             "processing_times": [],
#             "failures": 0
#         }

#     frames_processed = 0
#     while True:
#         ok, frame = capture.read()
#         if not ok:
#             break
            
#         frames_processed += 1
#         for name, t_data in active_trackers.items():
#             start_t = time.perf_counter()
#             success, box = t_data["obj"].update(frame)
#             elapsed = max(time.perf_counter() - start_t, 0.0001)
#             t_data["processing_times"].append(elapsed)
            
#             if success:
#                 safe_tracked_box = list(map(int, clamp_bbox(box)))
#                 t_data["trajectory"].append(safe_tracked_box)
#             else:
#                 t_data["failures"] += 1
#                 t_data["trajectory"].append(t_data["trajectory"][-1])

#     capture.release()

#     for name, t_data in active_trackers.items():
#         total_time = sum(t_data["processing_times"])
#         avg_fps = (frames_processed / total_time) if total_time > 0 else 0.0
        
#         result = {
#             "tracker": name,
#             "fps": round(avg_fps, 2),
#             "status": t_data["mode"],
#             "failures": t_data["failures"],
#             "num_frames_processed": frames_processed,
#             "trajectory": t_data["trajectory"],
#             "note": "Simulated using KCF" if t_data["mode"] == "simulated" else "Native OpenCV implementation"
#         }
#         results.append(result)

#     summary = {
#         "session_id": session_id,
#         "status": "completed",
#         "results": results,
#         "benchmarks": {
#             "average_fps": round(sum(item.get("fps", 0) for item in results) / max(len(active_trackers), 1), 2),
#             "frames_analyzed": frames_processed
#         },
#     }

#     sessions.update_one(
#         {"_id": session_id},
#         {"$set": {
#             "bbox": request.bbox, 
#             "trackers": request.trackers, 
#             "results": results, 
#             "summary": summary["benchmarks"], 
#             "updated_at": datetime.now(timezone.utc)
#         }}
#     )
    
#     return summary

# with auth
# from __future__ import annotations

# import math
# import os
# import time
# from datetime import datetime, timedelta, timezone
# from pathlib import Path
# from typing import Any
# from uuid import uuid4

# import certifi
# import cv2
# import jwt
# from fastapi import Depends, FastAPI, File, HTTPException, UploadFile, BackgroundTasks
# from fastapi.middleware.cors import CORSMiddleware
# from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
# from passlib.context import CryptContext
# from pydantic import BaseModel, Field
# from pymongo import MongoClient

# # --- Configuration ---
# UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "./uploads"))
# UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# # Replace this default string with your actual MongoDB Atlas connection string
# MONGO_URI = os.getenv("MONGO_URI", "mongodb+srv://ntekimemmanuelekpo_db_user:D1a6DwYOfhXHsVk2@visualtrackercluster.n37mnmm.mongodb.net/?appName=VisualTrackerCluster")
# MONGO_DATABASE = os.getenv("MONGO_DATABASE", "visualtracker")

# SECRET_KEY = os.getenv("JWT_SECRET", "super-secret-key-change-in-production")
# ALGORITHM = "HS256"

# app = FastAPI(title="VisualTracker Studio API", version="1.1.0")
# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=[os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")],
#     allow_methods=["*"],
#     allow_headers=["*"],
# )

# # --- Security  ---
# pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
# oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

# # --- Database Initialization ---
# try:
#     # certifi is required for secure TLS connections to MongoDB Atlas
#     mongo = MongoClient(MONGO_URI, tlsCAFile=certifi.where(), serverSelectionTimeoutMS=5000)
#     mongo.admin.command("ping")
#     db = mongo[MONGO_DATABASE]
#     sessions = db["sessions"]
#     users_col = db["users"]
#     print("Successfully connected to MongoDB Atlas.")
# except Exception as e:
#     print(f"MongoDB connection failed: {e}")
#     mongo = None
#     sessions, users_col = None, None

# # --- Pydantic Models ---
# class UserCreate(BaseModel):
#     email: str
#     password: str

# class TrackRequest(BaseModel):
#     bbox: dict[str, float] = Field(..., description="x, y, width and height in source pixels")
#     trackers: list[str] = Field(min_length=1, description="List of algorithms e.g., ['CSRT', 'KCF', 'MOSSE', 'GOTURN']")

# # --- Auth Helpers ---
# def verify_password(plain_password, hashed_password):
#     return pwd_context.verify(plain_password, hashed_password)

# def get_password_hash(password):
#     return pwd_context.hash(password)

# def get_current_user(token: str = Depends(oauth2_scheme)):
#     try:
#         payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
#         user_id: str = payload.get("sub")
#         if user_id is None:
#             raise HTTPException(status_code=401, detail="Invalid token")
#         return user_id
#     except jwt.PyJWTError:
#         raise HTTPException(status_code=401, detail="Invalid token")

# # --- Helper Functions ---
# def metadata(path: Path) -> dict[str, float | int]:
#     capture = cv2.VideoCapture(str(path))
#     if not capture.isOpened():
#         raise HTTPException(status_code=422, detail="The uploaded file is not a readable video.")

#     values = {
#         "frames": int(capture.get(cv2.CAP_PROP_FRAME_COUNT)),
#         "fps": float(capture.get(cv2.CAP_PROP_FPS) or 0),
#         "width": int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)),
#         "height": int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)),
#     }
#     capture.release()
#     return values

# def clamp_bbox(box: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
#     x, y, w, h = box
#     return (max(0.0, x), max(0.0, y), max(1.0, w), max(1.0, h))

# def tracker_factory(name: str):
#     normalized = name.upper()
#     # GOTURN fallback / simulation if deep model weights are missing
#     if normalized == "GOTURN":
#         creator = getattr(cv2, "TrackerKCF_create", None)
#         if creator is None and hasattr(cv2, "legacy"):
#             creator = getattr(cv2.legacy, "TrackerKCF_create", None)
#         return (creator() if creator else None, "simulated")

#     creator = getattr(cv2, f"Tracker{normalized}_create", None)
#     if creator is None and hasattr(cv2, "legacy"):
#         creator = getattr(cv2.legacy, f"Tracker{normalized}_create", None)
#     return (creator() if creator else None, "native")

# # --- API Endpoints ---
# @app.get("/")
# def read_root():
#     return {"message": "Welcome to the VisualTracker Studio API"}

# @app.get("/health")
# def health() -> dict[str, str]:
#     return {"status": "ok", "database": "connected" if sessions is not None else "unavailable"}

# @app.post("/api/auth/register")
# def register(user: UserCreate):
#     if users_col is None:
#         raise HTTPException(status_code=503, detail="Database offline")
#     if users_col.find_one({"email": user.email}):
#         raise HTTPException(status_code=400, detail="Email already registered")
    
#     users_col.insert_one({
#         "_id": str(uuid4()),
#         "email": user.email,
#         "password_hash": get_password_hash(user.password),
#         "created_at": datetime.now(timezone.utc)
#     })
#     return {"message": "User created successfully"}

# @app.post("/api/auth/login")
# def login(form_data: OAuth2PasswordRequestForm = Depends()):
#     if users_col is None:
#         raise HTTPException(status_code=503, detail="Database offline")
        
#     user = users_col.find_one({"email": form_data.username})
#     if not user or not verify_password(form_data.password, user["password_hash"]):
#         raise HTTPException(status_code=401, detail="Incorrect email or password")
        
#     access_token = jwt.encode(
#         {"sub": user["_id"], "exp": datetime.now(timezone.utc) + timedelta(days=7)},
#         SECRET_KEY, 
#         algorithm=ALGORITHM
#     )
#     return {"access_token": access_token, "token_type": "bearer"}

# @app.get("/api/sessions")
# def get_sessions(user_id: str = Depends(get_current_user)):
#     if sessions is None:
#         raise HTTPException(status_code=503, detail="MongoDB Atlas is unavailable.")
    
#     # Retrieve sessions scoped to the current user
#     cursor = sessions.find({"user_id": user_id}, {"results.trajectory": 0}).sort("created_at", -1)
#     history = []
#     for doc in cursor:
#         doc["id"] = doc.pop("_id")
#         history.append(doc)
#     return history

# @app.post("/api/sessions")
# async def create_session(file: UploadFile = File(...), user_id: str = Depends(get_current_user)):
#     if not file.content_type or not file.content_type.startswith("video/"):
#         raise HTTPException(status_code=415, detail="Please upload a video file.")

#     session_id = str(uuid4())
#     path = UPLOAD_DIR / f"{session_id}_{Path(file.filename or 'video').name}"
    
#     # Save video chunk by chunk
#     with open(path, "wb") as buffer:
#         while content := await file.read(1024 * 1024):  # 1MB chunks
#             buffer.write(content)
            
#     video = metadata(path)
#     document = {
#         "_id": session_id,
#         "user_id": user_id,
#         "filename": file.filename,
#         "path": str(path),
#         **video,
#         "created_at": datetime.now(timezone.utc),
#     }
    
#     if sessions is not None:
#         sessions.insert_one(document)

#     return {"id": session_id, "filename": file.filename, **video}

# @app.post("/api/sessions/{session_id}/track")
# def track(session_id: str, request: TrackRequest, user_id: str = Depends(get_current_user)):
#     if sessions is None:
#         raise HTTPException(status_code=503, detail="MongoDB Atlas is unavailable.")

#     # Find the specific session scoped to the user
#     session = sessions.find_one({"_id": session_id, "user_id": user_id})
#     if session is None:
#         raise HTTPException(status_code=404, detail="Tracking session not found.")

#     required = {"x", "y", "width", "height"}
#     if set(request.bbox) != required or any(value < 0 for value in request.bbox.values()) or request.bbox["width"] <= 0 or request.bbox["height"] <= 0:
#         raise HTTPException(status_code=422, detail="Bounding box dimensions must be positive.")

#     capture = cv2.VideoCapture(session["path"])
#     if not capture.isOpened():
#         raise HTTPException(status_code=422, detail="Video could not be opened.")

#     ok, frame0 = capture.read()
#     if not ok:
#         capture.release()
#         raise HTTPException(status_code=422, detail="Video has no readable frames.")

#     # Get actual frame dimensions
#     frame_height, frame_width = frame0.shape[:2]

#     # Safely unpack and cast the requested box
#     req_x, req_y, req_w, req_h = [int(request.bbox[k]) for k in ("x", "y", "width", "height")]
    
#     # Clamp coordinates strictly to the video frame boundaries
#     safe_x = max(0, min(req_x, frame_width - 1))
#     safe_y = max(0, min(req_y, frame_height - 1))
#     safe_w = max(1, min(req_w, frame_width - safe_x))
#     safe_h = max(1, min(req_h, frame_height - safe_y))
    
#     initial_box_int = (safe_x, safe_y, safe_w, safe_h)

#     # Initialize all requested trackers dynamically
#     active_trackers = {}
#     results = []
    
#     for name in request.trackers:
#         tracker_obj, mode = tracker_factory(name)
#         if tracker_obj is None:
#             results.append({
#                 "tracker": name,
#                 "status": "unsupported",
#                 "note": "Tracker missing from local OpenCV runtime."
#             })
#             continue
            
#         tracker_obj.init(frame0, initial_box_int)
#         active_trackers[name] = {
#             "obj": tracker_obj,
#             "mode": mode,
#             "trajectory": [list(initial_box_int)],
#             "processing_times": [],
#             "failures": 0
#         }

#     # Process video strictly frame-by-frame (OOM safe)
#     frames_processed = 0
#     while True:
#         ok, frame = capture.read()
#         if not ok:
#             break
            
#         frames_processed += 1
        
#         for name, t_data in active_trackers.items():
#             start_t = time.perf_counter()
#             success, box = t_data["obj"].update(frame)
#             elapsed = max(time.perf_counter() - start_t, 0.0001)
            
#             t_data["processing_times"].append(elapsed)
            
#             if success:
#                 t_data["trajectory"].append(list(map(int, clamp_bbox(box))))
#             else:
#                 t_data["failures"] += 1
#                 # Fallback to last known position on failure
#                 t_data["trajectory"].append(t_data["trajectory"][-1])

#     capture.release()

#     # Compile results
#     for name, t_data in active_trackers.items():
#         total_time = sum(t_data["processing_times"])
#         avg_fps = (frames_processed / total_time) if total_time > 0 else 0.0
        
#         result = {
#             "tracker": name,
#             "fps": round(avg_fps, 2),
#             "status": t_data["mode"],
#             "failures": t_data["failures"],
#             "num_frames_processed": frames_processed,
#             "trajectory": t_data["trajectory"], # Return coordinates for Next.js frontend plotting
#             "note": "Simulated using KCF" if t_data["mode"] == "simulated" else "Native OpenCV implementation"
#         }
#         results.append(result)

#     summary = {
#         "session_id": session_id,
#         "status": "completed",
#         "results": results,
#         "benchmarks": {
#             "average_fps": round(sum(item.get("fps", 0) for item in results) / max(len(active_trackers), 1), 2),
#             "frames_analyzed": frames_processed
#         },
#     }

#     # Persist tracking coordinates and results to Atlas
#     sessions.update_one(
#         {"_id": session_id},
#         {"$set": {
#             "bbox": request.bbox, 
#             "trackers": request.trackers, 
#             "results": results, 
#             "summary": summary["benchmarks"], 
#             "updated_at": datetime.now(timezone.utc)
#         }}
#     )
    
#     return summary

from __future__ import annotations

import math
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from uuid import uuid4

import certifi
import cv2
import jwt
from fastapi import FastAPI, File, HTTPException, UploadFile, Depends, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from passlib.context import CryptContext
from pydantic import BaseModel, Field
from pymongo import MongoClient

# --- Configuration ---
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "./uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

MONGO_URI = os.getenv("MONGO_URI", "mongodb+srv://ntekimemmanuelekpo_db_user:D1a6DwYOfhXHsVk2@visualtrackercluster.n37mnmm.mongodb.net/?appName=VisualTrackerCluster")
MONGO_DATABASE = os.getenv("MONGO_DATABASE", "visualtracker")

SECRET_KEY = os.getenv("JWT_SECRET", "super-secret-key-change-in-production")
ALGORITHM = "HS256"

app = FastAPI(title="VisualTracker Studio API", version="1.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Security & DB Initialization ---
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

try:
    mongo = MongoClient(MONGO_URI, tlsCAFile=certifi.where(), serverSelectionTimeoutMS=5000)
    mongo.admin.command("ping")
    db = mongo[MONGO_DATABASE]
    sessions = db["sessions"]
    users_col = db["users"]
    print("Successfully connected to MongoDB Atlas.")
except Exception as e:
    print(f"MongoDB connection failed: {e}")
    mongo = None
    sessions, users_col = None, None

# --- Pydantic Models ---
class UserCreate(BaseModel):
    email: str
    password: str

class TrackRequest(BaseModel):
    bbox: dict[str, float] = Field(..., description="x, y, width and height in source pixels")
    trackers: list[str] = Field(min_length=1)

# --- Auth Helpers ---
def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def get_current_user(token: str = Depends(oauth2_scheme)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        return user_id
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

# --- Vision & Math Helpers ---
def metadata(path: Path) -> dict[str, float | int]:
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise HTTPException(status_code=422, detail="The uploaded file is not a readable video.")
    values = {
        "frames": int(capture.get(cv2.CAP_PROP_FRAME_COUNT)),
        "fps": float(capture.get(cv2.CAP_PROP_FPS) or 0),
        "width": int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)),
        "height": int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)),
    }
    capture.release()
    return values

def clamp_bbox(box: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    x, y, w, h = box
    return (max(0.0, x), max(0.0, y), max(1.0, w), max(1.0, h))

def calculate_iou(boxA, boxB):
    # box format: (x, y, w, h)
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[0] + boxA[2], boxB[0] + boxB[2])
    yB = min(boxA[1] + boxA[3], boxB[1] + boxB[3])

    interArea = max(0, xB - xA) * max(0, yB - yA)
    boxAArea = boxA[2] * boxA[3]
    boxBArea = boxB[2] * boxB[3]
    unionArea = boxAArea + boxBArea - interArea

    return interArea / float(unionArea) if unionArea > 0 else 0.0

def calculate_cle(boxA, boxB):
    # box format: (x, y, w, h)
    centerA_x = boxA[0] + boxA[2] / 2.0
    centerA_y = boxA[1] + boxA[3] / 2.0
    centerB_x = boxB[0] + boxB[2] / 2.0
    centerB_y = boxB[1] + boxB[3] / 2.0
    return math.sqrt((centerA_x - centerB_x)**2 + (centerA_y - centerB_y)**2)

def tracker_factory(name: str):
    normalized = name.upper()
    if normalized == "GOTURN":
        # Attempts to load real Deep Learning GOTURN. Fails over to KCF if weights are missing.
        try:
            return (cv2.TrackerGOTURN_create(), "native")
        except cv2.error:
            creator = getattr(cv2, "TrackerKCF_create", None)
            if creator is None and hasattr(cv2, "legacy"):
                creator = getattr(cv2.legacy, "TrackerKCF_create", None)
            return (creator() if creator else None, "simulated")

    creator = getattr(cv2, f"Tracker{normalized}_create", None)
    if creator is None and hasattr(cv2, "legacy"):
        creator = getattr(cv2.legacy, f"Tracker{normalized}_create", None)
    return (creator() if creator else None, "native")


# --- Endpoints ---
@app.get("/")
def health_check():
    return {"status": "ok"}

@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}

@app.post("/api/auth/register")
def register(user: UserCreate):
    if users_col is None:
        raise HTTPException(status_code=503, detail="Database offline")
    if users_col.find_one({"email": user.email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    
    users_col.insert_one({
        "_id": str(uuid4()),
        "email": user.email,
        "password_hash": get_password_hash(user.password),
        "created_at": datetime.now(timezone.utc)
    })
    return {"message": "User created successfully"}

@app.post("/api/auth/login")
def login(form_data: OAuth2PasswordRequestForm = Depends()):
    if users_col is None:
        raise HTTPException(status_code=503, detail="Database offline")
        
    user = users_col.find_one({"email": form_data.username})
    if not user or not verify_password(form_data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
        
    access_token = jwt.encode(
        {"sub": user["_id"], "exp": datetime.now(timezone.utc) + timedelta(days=7)},
        SECRET_KEY, 
        algorithm=ALGORITHM
    )
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/api/sessions")
def get_sessions(user_id: str = Depends(get_current_user)):
    cursor = sessions.find({"user_id": user_id}, {"results.trajectory": 0, "gt_boxes": 0}).sort("created_at", -1)
    history = []
    for doc in cursor:
        doc["id"] = doc.pop("_id")
        history.append(doc)
    return history

@app.post("/api/sessions")
async def create_session(file: UploadFile = File(...), gt_file: Optional[UploadFile] = File(None), user_id: str = Depends(get_current_user)):
    if not file.content_type or not file.content_type.startswith("video/"):
        raise HTTPException(status_code=415, detail="Please upload a video file.")

    session_id = str(uuid4())
    path = UPLOAD_DIR / f"{session_id}_{Path(file.filename or 'video').name}"
    
    with open(path, "wb") as buffer:
        while content := await file.read(1024 * 1024): 
            buffer.write(content)
            
    video = metadata(path)
    
    # Process Ground Truth if provided
    gt_boxes = []
    if gt_file:
        gt_content = await gt_file.read()
        lines = gt_content.decode('utf-8').strip().split('\n')
        for line in lines:
            parts = line.replace('\t', ',').split(',')
            if len(parts) >= 4:
                try:
                    gt_boxes.append([float(p.strip()) for p in parts[:4]])
                except ValueError:
                    continue

    document = {
        "_id": session_id,
        "user_id": user_id,
        "filename": file.filename,
        "path": str(path),
        **video,
        "gt_boxes": gt_boxes,
        "has_ground_truth": len(gt_boxes) > 0,
        "created_at": datetime.now(timezone.utc),
    }
    sessions.insert_one(document)
    return {"id": session_id, "filename": file.filename, "has_ground_truth": document["has_ground_truth"], **video}

@app.post("/api/sessions/{session_id}/track")
def track(session_id: str, request: TrackRequest, user_id: str = Depends(get_current_user)):
    session = sessions.find_one({"_id": session_id, "user_id": user_id})
    if session is None:
        raise HTTPException(status_code=404, detail="Tracking session not found.")

    capture = cv2.VideoCapture(session["path"])
    ok, frame0 = capture.read()
    if not ok:
        capture.release()
        raise HTTPException(status_code=422, detail="Video has no readable frames.")

    frame_height, frame_width = frame0.shape[:2]
    req_x, req_y, req_w, req_h = [int(request.bbox[k]) for k in ("x", "y", "width", "height")]
    safe_x, safe_y = max(0, min(req_x, frame_width - 1)), max(0, min(req_y, frame_height - 1))
    safe_w, safe_h = max(1, min(req_w, frame_width - safe_x)), max(1, min(req_h, frame_height - safe_y))
    initial_box_int = (safe_x, safe_y, safe_w, safe_h)

    gt_data = session.get("gt_boxes", [])

    active_trackers = {}
    results = []
    
    for name in request.trackers:
        tracker_obj, mode = tracker_factory(name)
        if tracker_obj is None:
            results.append({"tracker": name, "status": "unsupported"})
            continue
            
        tracker_obj.init(frame0, initial_box_int)
        active_trackers[name] = {"obj": tracker_obj, "mode": mode, "trajectory": [list(initial_box_int)], "processing_times": [], "ious": [], "cles": [], "failures": 0}

    frame_idx = 1
    while True:
        ok, frame = capture.read()
        if not ok: break
        
        current_gt = gt_data[frame_idx] if frame_idx < len(gt_data) else None

        for name, t_data in active_trackers.items():
            start_t = time.perf_counter()
            success, box = t_data["obj"].update(frame)
            t_data["processing_times"].append(max(time.perf_counter() - start_t, 0.0001))
            
            if success:
                safe_box = list(map(int, clamp_bbox(box)))
                t_data["trajectory"].append(safe_box)
                
                # Perform Academic Math if GT exists
                if current_gt:
                    t_data["ious"].append(calculate_iou(safe_box, current_gt))
                    t_data["cles"].append(calculate_cle(safe_box, current_gt))
            else:
                t_data["failures"] += 1
                t_data["trajectory"].append(t_data["trajectory"][-1])
                if current_gt:
                    t_data["ious"].append(0.0)
                    t_data["cles"].append(999.0) # Penalty for losing target
        
        frame_idx += 1

    capture.release()

    for name, t_data in active_trackers.items():
        total_time = sum(t_data["processing_times"])
        frames_processed = frame_idx - 1
        
        precision = (sum(1 for cle in t_data["cles"] if cle <= 20) / len(t_data["cles"]) * 100) if t_data["cles"] else None
        success_auc = (sum(t_data["ious"]) / len(t_data["ious"]) * 100) if t_data["ious"] else None

        results.append({
            "tracker": name,
            "fps": round(frames_processed / total_time, 2) if total_time > 0 else 0.0,
            "precision": round(precision, 2) if precision is not None else None,
            "success_auc": round(success_auc, 2) if success_auc is not None else None,
            "status": t_data["mode"],
            "failures": t_data["failures"],
            "num_frames_processed": frames_processed,
            "trajectory": t_data["trajectory"],
            "note": "Requires deep model weights for native execution" if t_data["mode"] == "simulated" else "Native correlation filter"
        })

    summary = {
        "session_id": session_id,
        "status": "completed",
        "results": results,
        "benchmarks": {
            "average_fps": round(sum(item.get("fps", 0) for item in results) / max(len(active_trackers), 1), 2), 
            "frames_analyzed": frame_idx - 1
        },
    }

    sessions.update_one({"_id": session_id}, {"$set": {"bbox": request.bbox, "trackers": request.trackers, "results": results, "summary": summary["benchmarks"], "updated_at": datetime.now(timezone.utc)}})
    return summary