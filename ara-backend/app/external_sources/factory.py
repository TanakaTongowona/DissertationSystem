# app/external_sources/factory.py
from typing import Dict, Type, Optional
from app.external_sources.base_connector import BaseBookConnector
from app.external_sources.google_books import GoogleBooksConnector
from app.external_sources.open_library import OpenLibraryConnector
# from app.external_sources.crossref import CrossRefConnector  # You'd implement this
from app.config import get_settings

class ConnectorFactory:
    """Factory for creating external source connectors"""
    
    _connectors: Dict[str, Type[BaseBookConnector]] = {
        "google_books": GoogleBooksConnector,
        "open_library": OpenLibraryConnector,
        # Add more as implemented
        # "crossref": CrossRefConnector,
    }
    
    _instances: Dict[str, BaseBookConnector] = {}
    
    @classmethod
    def get_connector(cls, source: str) -> Optional[BaseBookConnector]:
        """Get or create a connector instance"""
        if source not in cls._connectors:
            return None
        
        # Return cached instance if exists
        if source in cls._instances:
            return cls._instances[source]
        
        # Create new instance
        settings = get_settings()
        
        # Pass API keys based on source
        if source == "google_books":
            instance = GoogleBooksConnector(api_key=settings.GOOGLE_BOOKS_API_KEY)
        else:
            instance = cls._connectors[source]()
        
        cls._instances[source] = instance
        return instance
    
    @classmethod
    async def close_all(cls):
        """Close all connector instances"""
        for instance in cls._instances.values():
            await instance.close()
        cls._instances.clear()