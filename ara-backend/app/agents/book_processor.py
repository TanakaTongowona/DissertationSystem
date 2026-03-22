# app/agents/book_processor.py
import PyPDF2
from pathlib import Path
from typing import List, Optional, Dict, Union
from sqlalchemy.orm import Session
from sentence_transformers import SentenceTransformer
import logging
import httpx
import asyncio
import tempfile
import os
import hashlib
import json
from datetime import datetime, timedelta
from app.database import models, crud
from app.config import get_settings
from app.external_sources.factory import ConnectorFactory
from app.external_sources.circuit_breaker import CircuitBreaker

logger = logging.getLogger(__name__)

class BookProcessor:
    """Process and index books into PostgreSQL - supports both local and external books"""
    
    def __init__(self, db: Session):
        self.db = db
        self.settings = get_settings()
        self.encoder = SentenceTransformer('all-MiniLM-L6-v2')
        
        # Create books folder if it doesn't exist
        Path(self.settings.BOOKS_FOLDER).mkdir(parents=True, exist_ok=True)
        
        # Create cache directory
        self.cache_dir = Path("./external_cache")
        self.cache_dir.mkdir(exist_ok=True)
        
        # HTTP client for general web fetching (not API calls)
        self.http_client = httpx.AsyncClient(timeout=30.0)
        
        # Circuit breakers for different APIs
        self.circuit_breakers = {
            "google_books": CircuitBreaker(
                failure_threshold=3, 
                recovery_timeout=300,  # 5 minutes
                name="google_books"
            ),
            "open_library": CircuitBreaker(
                failure_threshold=3, 
                recovery_timeout=120,  # 2 minutes
                name="open_library"
            ),
            "crossref": CircuitBreaker(
                failure_threshold=3, 
                recovery_timeout=120,
                name="crossref"
            )
        }
    
    async def close(self):
        """Close HTTP client"""
        await self.http_client.aclose()
    
    def _get_cache_key(self, source: str, source_id: str) -> str:
        """Generate cache key for external content"""
        key_str = f"{source}:{source_id}"
        return hashlib.md5(key_str.encode()).hexdigest()
    
    def _get_cached_content(self, cache_key: str, max_age_hours: int = 24) -> Optional[str]:
        """Get cached content if not expired"""
        cache_file = self.cache_dir / f"{cache_key}.json"
        
        if cache_file.exists():
            try:
                with open(cache_file, 'r') as f:
                    data = json.load(f)
                
                cached_time = datetime.fromisoformat(data["cached_at"])
                age = datetime.now() - cached_time
                
                if age < timedelta(hours=max_age_hours):
                    logger.info(f"Cache hit for {cache_key} (age: {age.total_seconds():.0f}s)")
                    return data["content"]
                else:
                    logger.info(f"Cache expired for {cache_key} (age: {age.total_seconds():.0f}s)")
            except Exception as e:
                logger.error(f"Error reading cache: {e}")
        
        return None
    
    def _save_to_cache(self, cache_key: str, content: str):
        """Save content to cache"""
        cache_file = self.cache_dir / f"{cache_key}.json"
        
        try:
            data = {
                "content": content,
                "cached_at": datetime.now().isoformat()
            }
            with open(cache_file, 'w') as f:
                json.dump(data, f)
            logger.info(f"Cached content for {cache_key}")
        except Exception as e:
            logger.error(f"Error saving to cache: {e}")
    
    def is_external_book(self, book: models.Book) -> bool:
        """Check if book is from external source"""
        return (book.metadata_json and 
                book.metadata_json.get("source") in ["google_books", "open_library", "crossref"])
    
    async def extract_text_from_external_book(self, book: models.Book) -> Optional[str]:
        """Extract text/content from external book source using connectors"""
        if not book.metadata_json:
            return None
        
        source = book.metadata_json.get("source")
        source_id = book.metadata_json.get("source_id")
        
        if not source or not source_id:
            return None
        
        # Check cache first
        cache_key = self._get_cache_key(source, source_id)
        cached = self._get_cached_content(cache_key)
        if cached:
            return cached
        
        # Get connector from factory
        connector = ConnectorFactory.get_connector(source)
        if not connector:
            logger.error(f"No connector found for source: {source}")
            return None
        
        # Get circuit breaker
        circuit_breaker = self.circuit_breakers.get(source)
        if not circuit_breaker:
            logger.warning(f"No circuit breaker for source: {source}")
            return await self._fetch_with_connector(connector, source_id, book.metadata_json)
        
        try:
            # Make API call with circuit breaker protection
            content = await circuit_breaker.call(
                self._fetch_with_connector,
                connector, source_id, book.metadata_json
            )
            
            # Cache successful result
            if content:
                self._save_to_cache(cache_key, content)
            
            return content
            
        except Exception as e:
            logger.error(f"Circuit breaker prevented request to {source}: {e}")
            
            # Try to get any cached content even if expired
            expired_cache = self._get_cached_content(cache_key, max_age_hours=720)  # 30 days
            if expired_cache:
                logger.info(f"Using expired cache for {source}:{source_id}")
                return expired_cache
            
            return None
    
    async def _fetch_with_connector(self, connector, source_id: str, metadata: dict) -> Optional[str]:
        """Fetch content using the appropriate connector"""
        try:
            # First try to get full book details
            book_data = await connector.fetch_by_id(source_id)
            
            if book_data and book_data.description:
                return book_data.description[:10000]
            
            # Fallback to preview URL if available
            preview_url = metadata.get("preview_url") or (book_data.preview_url if book_data else None)
            if preview_url:
                return await self._fetch_web_content(preview_url)
            
            return None
            
        except Exception as e:
            logger.error(f"Error fetching with connector: {e}")
            raise  # Re-raise for circuit breaker
    
    async def _fetch_google_books_content(self, volume_id: str) -> Optional[str]:
        """
        DEPRECATED: Use connector instead
        Keeping for backward compatibility but will log warning
        """
        logger.warning("Direct Google Books API call deprecated. Use connector.")
        connector = ConnectorFactory.get_connector("google_books")
        if connector:
            book_data = await connector.fetch_by_id(volume_id)
            return book_data.description[:10000] if book_data and book_data.description else None
        return None
    
    async def _fetch_open_library_content(self, olid: str) -> Optional[str]:
        """DEPRECATED: Use connector instead"""
        logger.warning("Direct Open Library API call deprecated. Use connector.")
        connector = ConnectorFactory.get_connector("open_library")
        if connector:
            book_data = await connector.fetch_by_id(olid)
            # You'd need to add description to your OpenLibrary connector
            return None
        return None
    
    async def _fetch_crossref_content(self, doi: str) -> Optional[str]:
        """DEPRECATED: Use connector instead"""
        logger.warning("Direct Crossref API call deprecated. Use connector.")
        return None
    
    async def _fetch_web_content(self, url: str) -> Optional[str]:
        """Fetch content from any web URL (used for preview pages)"""
        try:
            response = await self.http_client.get(url, follow_redirects=True)
            if response.status_code == 200:
                import re
                html_content = response.text
                # Simple HTML tag removal
                text = re.sub('<[^<]+?>', '', html_content)
                text = re.sub(r'\s+', ' ', text).strip()
                return text[:10000]
        except Exception as e:
            logger.error(f"Error fetching web content from {url}: {e}")
        return None
    
    def extract_text_from_pdf(self, pdf_path: str) -> Optional[str]:
        """Extract text from local PDF file"""
        try:
            text = ""
            with open(pdf_path, 'rb') as file:
                reader = PyPDF2.PdfReader(file)
                for page in reader.pages:
                    page_text = page.extract_text()
                    if page_text:
                        text += page_text + "\n"
            
            return text[:10000]
        except Exception as e:
            logger.error(f"Error extracting text from {pdf_path}: {e}")
            return None
    
    def extract_metadata(self, file_path: str, content: Optional[str]) -> dict:
        """Extract basic metadata from local file"""
        path = Path(file_path)
        return {
            "filename": path.name,
            "extension": path.suffix,
            "size_bytes": path.stat().st_size,
            "created": path.stat().st_ctime,
            "modified": path.stat().st_mtime,
            "content_preview": content[:500] if content else None
        }
    
    def index_book(self, file_path: str, title: Optional[str] = None, author: Optional[str] = None) -> dict:
        """Index a single local book"""
        logger.info(f"Indexing book: {file_path}")
        
        # Extract text
        content = self.extract_text_from_pdf(file_path)
        
        # Generate embedding if we have content
        embedding = None
        if content:
            embedding = self.encoder.encode(content).tolist()
        
        # Extract metadata
        metadata = self.extract_metadata(file_path, content)
        
        # Use filename as title if not provided
        if not title:
            title = Path(file_path).stem
        
        # Check if book already exists
        existing = self.db.query(models.Book).filter(
            models.Book.file_path == file_path
        ).first()
        
        if existing:
            # Update existing
            existing.title = title
            existing.author = author
            existing.content = content
            existing.embedding = embedding
            existing.metadata_json = metadata
            logger.info(f"Updated existing book: {title}")
        else:
            # Create new
            book = models.Book(
                title=title,
                author=author,
                file_path=file_path,
                file_size=metadata["size_bytes"],
                content=content,
                metadata_json=metadata,
                embedding=embedding
            )
            self.db.add(book)
            logger.info(f"Added new book: {title}")
        
        self.db.commit()
        
        return {
            "title": title,
            "file_path": file_path,
            "indexed": True,
            "content_length": len(content) if content else 0,
            "book_type": "local"
        }
    
    # Add this to your BookProcessor class

    async def index_external_book(self, book_id: int) -> dict:
        """Index an external book by fetching content from its source"""
        logger.info(f"Indexing external book ID: {book_id}")
        
        # Get book from database
        book = crud.get_book(self.db, book_id)
        if not book:
            return {"error": "Book not found"}
        
        if not self.is_external_book(book):
            return {"error": "Not an external book"}
        
        # Extract content from external source
        content = await self.extract_text_from_external_book(book)
        
        # Generate embedding if we have content
        embedding = None
        if content:
            embedding = self.encoder.encode(content).tolist()
        
        # Create enhanced metadata that matches local book format
        enhanced_metadata = self._create_external_metadata(book, content)
        
        # Update book with content, embedding, and enhanced metadata
        book.content = content
        book.embedding = embedding
        book.metadata_json = enhanced_metadata
        
        # Update title and author from enhanced metadata
        if enhanced_metadata.get("title"):
            book.title = enhanced_metadata["title"]
        if enhanced_metadata.get("authors") and len(enhanced_metadata["authors"]) > 0:
            book.author = ", ".join(enhanced_metadata["authors"])
        
        self.db.commit()
        
        logger.info(f"Successfully indexed external book {book_id} with enhanced metadata")
        
        return {
            "book_id": book_id,
            "title": book.title,
            "indexed": embedding is not None,
            "content_length": len(content) if content else 0,
            "book_type": "external",
            "metadata": {
                "filename": enhanced_metadata.get("filename"),
                "size_bytes": enhanced_metadata.get("size_bytes"),
                "content_preview": enhanced_metadata.get("content_preview"),
                "source": enhanced_metadata.get("source"),
                "source_id": enhanced_metadata.get("source_id")
            }
        }

    def _create_external_metadata(self, book: models.Book, content: Optional[str]) -> dict:
        """Create enhanced metadata for external books matching local format"""
        
        # Start with existing metadata from external source
        metadata = book.metadata_json.copy() if book.metadata_json else {}
        
        # Get title from various sources
        title = (
            metadata.get("title") or 
            book.title or 
            "Unknown Book"
        )
        
        # Create filename from title
        # Remove invalid filename characters
        safe_title = "".join(c for c in title if c.isalnum() or c in " ._-").rstrip()
        filename = f"{safe_title}.pdf"
        
        # Generate content preview
        content_preview = None
        if content and len(content) > 0:
            content_preview = content[:500] + "..." if len(content) > 500 else content
        elif metadata.get("description"):
            desc = metadata["description"]
            content_preview = desc[:500] + "..." if len(desc) > 500 else desc
        elif metadata.get("summary"):
            summary = metadata["summary"]
            content_preview = summary[:500] + "..." if len(summary) > 500 else summary
        
        # Calculate estimated size
        content_length = len(content) if content else 0
        estimated_size_bytes = max(content_length * 2, 1024)  # At least 1KB
        
        # Get current timestamp
        now = datetime.now()
        timestamp = now.timestamp()
        
        # Build enhanced metadata
        enhanced_metadata = {
            # Local-style fields
            "filename": filename,
            "extension": ".pdf",
            "size_bytes": estimated_size_bytes,
            "created": timestamp,
            "modified": timestamp,
            "content_preview": content_preview,
            
            # External source info
            "source_type": "external",
            "original_source": metadata.get("source", "unknown"),
            "source_id": metadata.get("source_id"),
            "indexed_at": now.isoformat(),
            
            # Keep all original external metadata
            **metadata
        }
        
        # Ensure we don't duplicate fields
        # (metadata already has source, source_id, etc.)
        
        return enhanced_metadata

    def get_book_metadata_summary(self, book_id: int) -> dict:
        """Helper to get a summary of book metadata (for debugging)"""
        book = crud.get_book(self.db, book_id)
        if not book:
            return {"error": "Book not found"}
        
        if book.metadata_json:
            return {
                "id": book.id,
                "title": book.title,
                "author": book.author,
                "metadata": {
                    "filename": book.metadata_json.get("filename"),
                    "size_bytes": book.metadata_json.get("size_bytes"),
                    "content_preview_length": len(book.metadata_json.get("content_preview", "")),
                    "source": book.metadata_json.get("source"),
                    "source_id": book.metadata_json.get("source_id"),
                    "indexed_at": book.metadata_json.get("indexed_at")
                }
            }
        else:
            return {"id": book.id, "title": book.title, "metadata": None}
    
    async def process_single_book(self, book_id: int, file_path: str) -> dict:
        """
        Process and index a single book by ID
        Handles both local and external books automatically
        """
        # Get book to check its type
        book = crud.get_book(self.db, book_id)
        if not book:
            return {"error": "Book not found"}
        
        # Check if it's an external book
        if self.is_external_book(book):
            return await self.index_external_book(book_id)
        else:
            # Local PDF book
            content = self.extract_text_from_pdf(file_path)
            embedding = None
            if content:
                embedding = self.encoder.encode(content).tolist()
            
            # Update book
            book = crud.update_book_embedding(self.db, book_id, embedding, content)
            
            # Update metadata
            metadata = self.extract_metadata(file_path, content)
            crud.update_book(self.db, book_id, {"metadata_json": metadata})
            
            return {
                "book_id": book_id,
                "title": book.title if book else "Unknown",
                "indexed": embedding is not None,
                "content_length": len(content) if content else 0,
                "book_type": "local"
            }
    
    def index_all_books(self) -> List[dict]:
        """Index all PDFs in the books folder"""
        results = []
        book_folder = Path(self.settings.BOOKS_FOLDER)
        
        for pdf_path in book_folder.glob("*.pdf"):
            try:
                result = self.index_book(str(pdf_path))
                results.append(result)
            except Exception as e:
                logger.error(f"Failed to index {pdf_path}: {e}")
                results.append({
                    "file_path": str(pdf_path),
                    "indexed": False,
                    "error": str(e)
                })
        
        return results
    
    def search_books(self, query: str, top_k: int = 10) -> List[Dict]:
        """Search books by semantic similarity"""
        from app.database import crud
        
        try:
            # Generate query embedding
            query_embedding = self.encoder.encode(query).tolist()
            logger.info(f"Generated query embedding of length {len(query_embedding)}")
            
            # Check for books with embeddings
            books_with_embeddings = self.db.query(models.Book).filter(
                models.Book.embedding.isnot(None)
            ).count()
            logger.info(f"Total books with embeddings: {books_with_embeddings}")
            
            if books_with_embeddings == 0:
                logger.warning("No books with embeddings found in database")
                return []
            
            # Search via CRUD
            results = crud.search_books_by_similarity(self.db, query_embedding, top_k)
            logger.info(f"Search returned {len(results)} results")
            
            return results
            
        except Exception as e:
            logger.error(f"Error in search_books: {e}")
            import traceback
            traceback.print_exc()
            return []