# app/external_sources/base_connector.py
from abc import ABC, abstractmethod
from typing import Optional, Dict
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential
import logging

from app.external_sources.models import ExternalBook, ExternalSearchResult

logger = logging.getLogger(__name__)

class BaseBookConnector(ABC):
    """Abstract base class for external book source connectors"""
    
    def __init__(self, api_key: Optional[str] = None, timeout: int = 30):
        self.api_key = api_key
        self.timeout = timeout
        self.client = httpx.AsyncClient(timeout=timeout)
    
    @abstractmethod
    async def search(self, query: str, limit: int = 10, page: int = 1) -> ExternalSearchResult:
        """Search for books by query string"""
        pass
    
    @abstractmethod
    async def fetch_by_isbn(self, isbn: str) -> Optional[ExternalBook]:
        """Fetch book by ISBN"""
        pass
    
    @abstractmethod
    async def fetch_by_id(self, source_id: str) -> Optional[ExternalBook]:
        """Fetch book by source's internal ID"""
        pass
    
    async def close(self):
        """Close HTTP client"""
        await self.client.aclose()
    
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10)
    )
    async def _make_request(self, url: str, params: Dict = None) -> Dict:
        """Make HTTP request with retry logic"""
        try:
            response = await self.client.get(url, params=params)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP error {e.response.status_code} from {url}: {e.response.text}")
            raise
        except Exception as e:
            logger.error(f"Request failed to {url}: {str(e)}")
            raise