from typing import List, Optional
from pydantic import BaseModel
from app.external_sources.models import ExternalBook


class ExternalSearchRequest(BaseModel):
    query: str
    sources: List[str] = ["google_books", "open_library"]  # Default sources
    limit: int = 10
    page: int = 1

class ExternalSearchResponse(BaseModel):
    results: List[ExternalBook]
    total: int
    source: str

class ImportRequest(BaseModel):
    source: str
    source_id: str
    title: Optional[str] = None
    author: Optional[str] = None
    auto_fetch_metadata: bool = True
