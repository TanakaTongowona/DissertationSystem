# app/external_sources/open_library.py
from typing import Optional, Dict
import httpx
from datetime import datetime

from app.external_sources.base_connector import BaseBookConnector
from app.external_sources.models import ExternalBook, ExternalSearchResult

class OpenLibraryConnector(BaseBookConnector):
    """
    Connector for Open Library API
    Documentation: https://openlibrary.org/developers/api
    """
    
    BASE_URL = "https://openlibrary.org"
    
    def __init__(self):
        super().__init__(api_key=None)  # No API key needed
    
    async def search(self, query: str, limit: int = 10, page: int = 1) -> ExternalSearchResult:
        """Search Open Library"""
        params = {
            "q": query,
            "limit": limit,
            "page": page,
            "fields": "key,title,author_name,first_publish_year,isbn,cover_i"
        }
        
        data = await self._make_request(f"{self.BASE_URL}/search.json", params)
        
        items = []
        for doc in data.get("docs", [])[:limit]:
            book = await self._parse_search_doc(doc)
            if book:
                items.append(book)
        
        return ExternalSearchResult(
            source="open_library",
            total_results=data.get("numFound", 0),
            items=items
        )
    
    async def fetch_by_isbn(self, isbn: str) -> Optional[ExternalBook]:
        """Fetch book by ISBN"""
        clean_isbn = isbn.replace("-", "").replace(" ", "")
        
        try:
            data = await self._make_request(f"{self.BASE_URL}/isbn/{clean_isbn}.json")
            return await self._parse_work(data)
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return None
            raise
    
    async def fetch_by_id(self, source_id: str) -> Optional[ExternalBook]:
        """Fetch book by Open Library ID (e.g., /books/OL123M)"""
        data = await self._make_request(f"{self.BASE_URL}{source_id}.json")
        return await self._parse_work(data)
    
    async def _parse_search_doc(self, doc: Dict) -> Optional[ExternalBook]:
        """Parse search result document"""
        try:
            # Get OLID from key (e.g., "/books/OL123M" -> "OL123M")
            olid = doc.get("key", "").replace("/books/", "")
            
            # Get first ISBN
            isbns = doc.get("isbn", [])
            isbn = isbns[0] if isbns else None
            
            # Get cover URL if available
            cover_id = doc.get("cover_i")
            cover_url = f"https://covers.openlibrary.org/b/id/{cover_id}-L.jpg" if cover_id else None
            
            return ExternalBook(
                source="open_library",
                source_id=olid,
                isbn=isbn,
                title=doc.get("title", ""),
                authors=doc.get("author_name", []),
                published_date=datetime(doc.get("first_publish_year", 1900), 1, 1).date() if doc.get("first_publish_year") else None,
                cover_url=cover_url,
                raw_data=doc
            )
        except Exception as e:
            print(f"Error parsing Open Library doc: {e}")
            return None
    
    async def _parse_work(self, work: Dict) -> Optional[ExternalBook]:
        """Parse full work record"""
        try:
            # Get OLID from key
            olid = work.get("key", "").replace("/books/", "")
            
            # Get description
            description = work.get("description")
            if isinstance(description, dict):
                description = description.get("value")
            
            return ExternalBook(
                source="open_library",
                source_id=olid,
                title=work.get("title", ""),
                authors=[work.get("by_statement", "")] if work.get("by_statement") else [],
                publishers=work.get("publishers", []),
                published_date=datetime.strptime(str(work.get("publish_date")), "%Y").date() if work.get("publish_date") else None,
                pages=work.get("number_of_pages"),
                description=description,
                subjects=work.get("subjects", []),
                raw_data=work
            )
        except Exception as e:
            print(f"Error parsing Open Library work: {e}")
            return None