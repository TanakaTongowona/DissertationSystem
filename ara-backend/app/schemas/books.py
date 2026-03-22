from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class BookResponse(BaseModel):
    id: int
    title: str
    author: Optional[str] = None
    file_path: str
    file_size: Optional[int] = None
    indexed: bool = False
    date_published: Optional[datetime] = None
    metadata_json: Optional[dict] = None 
    created_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class BookDetailResponse(BookResponse):
    content_preview: Optional[str] = None
    embedding_status: Optional[str] = None  # "indexed" or "pending"

class BookSearchQuery(BaseModel):
    query: str
    top_k: int = 10
    min_similarity: float = 0.4

