# app/external_sources/models.py
from pydantic import BaseModel, Field
from typing import Optional, List, Dict
from datetime import date

class ExternalBook(BaseModel):
    """Standardized book model from any external source"""
    # Core identifiers
    source: str  # "google_books", "open_library", etc.
    source_id: str  # ID in the source system
    isbn: Optional[str] = None
    isbn13: Optional[str] = None
    doi: Optional[str] = None  # Digital Object Identifier
    oclc: Optional[str] = None  # WorldCat ID
    
    # Bibliographic metadata
    title: str
    subtitle: Optional[str] = None
    authors: List[str] = Field(default_factory=list)
    publishers: List[str] = Field(default_factory=list)
    published_date: Optional[date] = None
    pages: Optional[int] = None
    language: Optional[str] = None
    
    # Descriptions
    description: Optional[str] = None
    summary: Optional[str] = None
    
    # Identifiers
    subjects: List[str] = Field(default_factory=list)  # Categories/tags
    keywords: List[str] = Field(default_factory=list)
    
    # Links and media
    thumbnail_url: Optional[str] = None
    cover_url: Optional[str] = None
    preview_url: Optional[str] = None
    info_url: Optional[str] = None
    
    # Raw response (for debugging)
    raw_data: Optional[Dict] = None
    
    class Config:
        arbitrary_types_allowed = True

class ExternalSearchResult(BaseModel):
    """Search results from external source"""
    source: str
    total_results: int
    items: List[ExternalBook]
    next_page_token: Optional[str] = None