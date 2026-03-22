# app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging
from fastapi.staticfiles import StaticFiles
import os
from app.api.routes import auth, books, research, health, users, ml, external_books, bulk_imports, dashboard
from app.database.session import engine
from app.database.models import Base
from app.config import get_settings
from sqlalchemy.orm import Session
from app.database import models, session
from app.auth_services import utils

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create database tables
Base.metadata.create_all(bind=engine)

# Create FastAPI app
app = FastAPI(
    title="Academic Research Agent",
    description="Deep thinking agent with RAG for academic research",
    version="1.0.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],  # React dev servers
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],  # Important for file downloads
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(books.router)
app.include_router(external_books.router)
app.include_router(bulk_imports.router)
app.include_router(research.router)
app.include_router(ml.router)
app.include_router(dashboard.router)
app.include_router(health.router)

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Mount the uploads directory to serve static files
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

@app.get("/")
async def root():
    return {
        "message": "Academic Research Agent API",
        "docs": "/docs",
        "health": "/health"
    }

@app.on_event("startup")
async def startup_event():
    logger.info("Starting up Academic Research Agent...")
    settings = get_settings()
    logger.info(f"Books folder: {settings.BOOKS_FOLDER}")
    logger.info(f"Ollama URL: {settings.OLLAMA_BASE_URL}")

@app.on_event("startup")
def seed_admin_user():
    db: Session = next(session.get_db())

    user_count = db.query(models.User).count()
    if user_count == 0:
        admin_user = models.User(
            email="admin@academy.com",
            first_name="Academy",
            last_name="Admin",
            password=utils.hash("password123"),
            is_superuser=True,
            is_active=True
        )

        db.add(admin_user)
        db.commit()
        db.refresh(admin_user)

        print("Admin user seeded: admin@academy.com / password123")
    else:
        print("Admin user exists. Auto seeding skipped")

@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Shutting down...")