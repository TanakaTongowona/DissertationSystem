from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
import aiohttp
import socket
from app.database.session import get_db
from app.agents.llm_router import LLMRouter
from app.schemas.research import HealthResponse
from app.database import models
from app.config import get_settings

router = APIRouter(prefix="/health", tags=["health"])

@router.get("", response_model=HealthResponse)
async def health_check(db: Session = Depends(get_db)):
    """Check system health and available providers"""
    settings = get_settings()
    router = LLMRouter()
    
    # Check Ollama
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{settings.OLLAMA_BASE_URL}/api/tags", timeout=2) as resp:
                ollama_running = resp.status == 200
    except:
        ollama_running = False
    
    # Check internet
    try:
        socket.create_connection(("8.8.8.8", 53), timeout=3)
        internet = True
    except:
        internet = False
    
    # Check database
    try:
        db.execute(text("SELECT 1"))
        db_connected = True
    except:
        db_connected = False
    
    # Count books
    books_count = db.query(models.Book).count()
    
    return HealthResponse(
        status="healthy" if db_connected else "degraded",
        ollama_running=ollama_running,
        internet_accessible=internet,
        books_count=books_count,
        database_connected=db_connected
    )