# app/external_sources/google_books.py
from typing import Optional, Dict
from datetime import datetime, timedelta
import isbnlib
import asyncio
import logging

from app.external_sources.base_connector import BaseBookConnector
from app.external_sources.models import ExternalBook, ExternalSearchResult

logger = logging.getLogger(__name__)

class GoogleBooksConnector(BaseBookConnector):
    """
    Connector for Google Books API with rate limiting
    Documentation: https://developers.google.com/books/docs/v1/using
    """
    
    BASE_URL = "https://www.googleapis.com/books/v1"
    
    # Rate limiting - 1 request per second (conservative)
    RATE_LIMIT = 1  # requests per second
    
    def __init__(self, api_key: Optional[str] = None):
        super().__init__(api_key)
        self.last_request_time = datetime.min
        self.request_timestamps = []
        self.daily_request_count = 0
        self.daily_reset_time = datetime.now() + timedelta(days=1)
    
    async def _wait_for_rate_limit(self):
        """Implement rate limiting - wait if needed"""
        now = datetime.now()
        
        # Reset daily counter if new day
        if now > self.daily_reset_time:
            logger.info("Resetting daily request counter")
            self.daily_request_count = 0
            self.daily_reset_time = now + timedelta(days=1)
            self.request_timestamps = []
        
        # Check daily limit (Google free tier: 1000 requests/day)
        if self.daily_request_count >= 900:  # Leave buffer
            wait_until = self.daily_reset_time
            sleep_seconds = (wait_until - now).total_seconds()
            if sleep_seconds > 0:
                logger.warning(f"Daily limit nearly reached. Waiting {sleep_seconds:.0f}s until reset")
                await asyncio.sleep(sleep_seconds)
                self.daily_request_count = 0
        
        # Clean old timestamps (older than 1 minute)
        self.request_timestamps = [ts for ts in self.request_timestamps 
                                   if ts > now - timedelta(minutes=1)]
        
        # Check per-second rate
        if len(self.request_timestamps) >= self.RATE_LIMIT:
            oldest = min(self.request_timestamps)
            wait_seconds = 1.0 - (now - oldest).total_seconds()
            if wait_seconds > 0:
                logger.debug(f"Rate limit: waiting {wait_seconds:.2f}s")
                await asyncio.sleep(wait_seconds)
        
        # Update tracking
        self.request_timestamps.append(now)
        self.daily_request_count += 1
    
    async def _make_request(self, url: str, params: Dict = None) -> Dict:
        """Make request with rate limiting"""
        await self._wait_for_rate_limit()
        
        # Add API key if available
        if self.api_key:
            if params is None:
                params = {}
            params["key"] = self.api_key
        
        try:
            response = await self.client.get(url, params=params)
            
            # Handle rate limit response
            if response.status_code == 429:
                retry_after = int(response.headers.get('Retry-After', 60))
                logger.warning(f"Google Books rate limited. Retry after {retry_after}s")
                await asyncio.sleep(retry_after)
                # Retry once after waiting
                response = await self.client.get(url, params=params)
            
            response.raise_for_status()
            return response.json()
            
        except Exception as e:
            logger.error(f"Google Books API request failed: {e}")
            raise
    
    async def search(self, query: str, limit: int = 10, page: int = 1) -> ExternalSearchResult:
        """Search Google Books"""
        start_index = (page - 1) * limit
        
        params = {
            "q": query,
            "maxResults": min(limit, 40),  # Google max is 40
            "startIndex": start_index
        }
        
        data = await self._make_request(f"{self.BASE_URL}/volumes", params)
        
        items = []
        for item in data.get("items", []):
            book = self._parse_volume(item)
            if book:
                items.append(book)
        
        return ExternalSearchResult(
            source="google_books",
            total_results=data.get("totalItems", 0),
            items=items
        )
    
    async def fetch_by_isbn(self, isbn: str) -> Optional[ExternalBook]:
        """Fetch book by ISBN"""
        # Clean ISBN
        clean_isbn = isbnlib.canonical(isbn)
        
        params = {
            "q": f"isbn:{clean_isbn}",
            "maxResults": 1
        }
        
        data = await self._make_request(f"{self.BASE_URL}/volumes", params)
        
        items = data.get("items", [])
        if items:
            return self._parse_volume(items[0])
        
        return None
    
    async def fetch_by_id(self, source_id: str) -> Optional[ExternalBook]:
        """Fetch book by Google Books volume ID"""
        params = {}
        data = await self._make_request(f"{self.BASE_URL}/volumes/{source_id}", params)
        return self._parse_volume(data)
    
    def _parse_volume(self, volume: Dict) -> Optional[ExternalBook]:
        """Parse Google Books volume JSON to standardized format"""
        try:
            volume_info = volume.get("volumeInfo", {})
            
            # Parse published date
            published_date = None
            date_str = volume_info.get("publishedDate")
            if date_str:
                try:
                    if len(date_str) == 4:  # Just year
                        published_date = datetime.strptime(date_str, "%Y").date()
                    elif len(date_str) == 7:  # Year-month
                        published_date = datetime.strptime(date_str, "%Y-%m").date()
                    else:  # Full date
                        published_date = datetime.strptime(date_str, "%Y-%m-%d").date()
                except:
                    pass
            
            # Extract ISBNs
            industry_ids = volume_info.get("industryIdentifiers", [])
            isbn10 = None
            isbn13 = None
            
            for id_dict in industry_ids:
                if id_dict.get("type") == "ISBN_10":
                    isbn10 = id_dict.get("identifier")
                elif id_dict.get("type") == "ISBN_13":
                    isbn13 = id_dict.get("identifier")
            
            # Get preview link and info link
            preview_link = volume_info.get("previewLink")
            info_link = volume_info.get("infoLink")
            
            return ExternalBook(
                source="google_books",
                source_id=volume.get("id"),
                isbn=isbn10,
                isbn13=isbn13,
                title=volume_info.get("title", ""),
                subtitle=volume_info.get("subtitle"),
                authors=volume_info.get("authors", []),
                publishers=[volume_info.get("publisher")] if volume_info.get("publisher") else [],
                published_date=published_date,
                pages=volume_info.get("pageCount"),
                language=volume_info.get("language"),
                description=volume_info.get("description"),
                subjects=volume_info.get("categories", []),
                thumbnail_url=volume_info.get("imageLinks", {}).get("thumbnail"),
                cover_url=volume_info.get("imageLinks", {}).get("smallThumbnail"),
                preview_url=preview_link,
                info_url=info_link,
                raw_data=volume
            )
        except Exception as e:
            logger.error(f"Error parsing Google Books volume: {e}")
            return None
    
    async def close(self):
        """Close the connector"""
        await self.client.aclose()