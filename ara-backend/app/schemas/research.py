# app/schemas/research.py
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from enum import Enum
from app.schemas.users import UserResponse
from datetime import datetime

class ResearchMethod(str, Enum):
    LIBRARY_ONLY = "library_only"
    LLM_GENERAL = "llm_general"
    SUGGEST_BOOKS = "suggest_books"
    WEB_FALLBACK = "web_fallback"
    ALL = "all"

class ResearchQuery(BaseModel):
    query: str
    method: ResearchMethod = ResearchMethod.ALL
    top_k: int = 5
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None 

class ResearchResponse(BaseModel):
    id: Optional[int]
    query: str
    research_plan: List[str]
    answer: str
    sources: List[dict]
    provider_log: List[dict]
    status: str
    confidence: float
    source_type: str
    provider: str
    research_method: ResearchMethod
    filter_info: Optional[Dict[str, Any]] = None
    owner_id: Optional[int] = None  # Add this field
    created_at: Optional[datetime] = None
    class Config:
        from_attributes = True

class Source(BaseModel):
    title: str
    similarity: float

class ProviderLog(BaseModel):
    step: str
    provider: Optional[str]
    model: Optional[str]

class ResearchSessionResponse(BaseModel):
    owner_id: int
    owner: UserResponse
    id: Optional[int] = None
    query: str
    plan: Optional[str] = None
    answer: Optional[str] = None
    sources: List[Dict[str, Any]] = []
    source_type: Optional[str] = None
    confidence: Optional[float] = None
    research_method: Optional[str] = None
    provider_log: List[Dict[str, Any]] = []
    created_at: Optional[datetime] = None
    status: str = "processing"

class BookIndexResponse(BaseModel):
    title: str
    file_path: str
    indexed: bool
    content_length: Optional[int] = None
    # message: Optional[str] = None  # Add optional message field
    error: Optional[str] = None

class IndexTriggerResponse(BaseModel):
    message: str
    books_queued: int
    task_id: str
    status: str
    
class HealthResponse(BaseModel):
    status: str
    ollama_running: bool
    internet_accessible: bool
    books_count: int
    database_connected: bool