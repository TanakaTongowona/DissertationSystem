# app/tasks/import_tasks.py
import logging
from typing import Dict
import httpx
from pathlib import Path

from app.database.session import SessionLocal
from app.database import models
from app.config import get_settings

logger = logging.getLogger(__name__)

async def import_book_background(book_data: Dict, user_id: int):
    """
    Background task to import a book into the library
    This runs asynchronously and doesn't block the API
    """
    db = SessionLocal()
    try:
        settings = get_settings()
        
        # Check if book already exists
        existing = None
        if book_data.get("isbn"):
            existing = db.query(models.Book).filter(
                models.Book.metadata_json.contains({"isbn": book_data["isbn"]})
            ).first()
        
        if existing:
            logger.info(f"Book already exists: {book_data['title']}")
            return
        
        # Download cover if available
        cover_path = None
        if book_data.get("cover_url"):
            try:
                cover_path = await download_cover(
                    book_data["cover_url"],
                    book_data["isbn"] or book_data["source_id"]
                )
            except Exception as e:
                logger.error(f"Failed to download cover: {e}")
        
        # Create book record
        book = models.Book(
            title=book_data["title"],
            author=", ".join(book_data.get("authors", [])),
            file_path=None,  # No PDF yet
            file_size=0,
            metadata_json={
                "source": book_data["source"],
                "source_id": book_data["source_id"],
                "isbn": book_data.get("isbn"),
                "isbn13": book_data.get("isbn13"),
                "publishers": book_data.get("publishers", []),
                "published_date": str(book_data.get("published_date")) if book_data.get("published_date") else None,
                "pages": book_data.get("pages"),
                "language": book_data.get("language"),
                "subjects": book_data.get("subjects", []),
                "cover_path": cover_path,
                "description": book_data.get("description"),
                "external_urls": {
                    "info": book_data.get("info_url"),
                    "preview": book_data.get("preview_url")
                }
            }
        )
        
        db.add(book)
        db.commit()
        
        logger.info(f"Successfully imported book: {book_data['title']}")
        
    except Exception as e:
        logger.error(f"Failed to import book: {e}")
        db.rollback()
    finally:
        db.close()

async def download_cover(url: str, identifier: str) -> str:
    """Download book cover image"""
    settings = get_settings()
    covers_dir = Path("covers")
    covers_dir.mkdir(exist_ok=True)
    
    filename = f"{identifier}.jpg"
    filepath = covers_dir / filename
    
    async with httpx.AsyncClient() as client:
        response = await client.get(url)
        response.raise_for_status()
        
        with open(filepath, "wb") as f:
            f.write(response.content)
    
    return str(filepath)