# app/utils/network.py
import asyncio
import socket
import aiohttp
from typing import Tuple
import logging

logger = logging.getLogger(__name__)

class NetworkDetector:
    """Detect network availability at runtime"""
    
    def __init__(self):
        self.internet_available = None
        self.ollama_available = None
        self.last_check = 0
        self.check_interval = 30  # seconds
    
    async def check_internet(self) -> bool:
        """Check if internet is accessible"""
        try:
            # Try multiple methods
            # Method 1: DNS lookup to Google DNS
            loop = asyncio.get_event_loop()
            await loop.getaddrinfo('8.8.8.8', 53)
            
            # Method 2: HTTP request to reliable endpoint
            async with aiohttp.ClientSession() as session:
                async with session.get('https://www.google.com', timeout=3) as response:
                    return response.status == 200
        except:
            return False
    
    async def check_ollama(self, base_url: str) -> bool:
        """Check if Ollama is running"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{base_url}/api/tags", timeout=2) as response:
                    return response.status == 200
        except:
            return False
    
    async def get_status(self, ollama_url: str) -> dict:
        """Get current network status (always fresh)"""
        internet, ollama = await asyncio.gather(
            self.check_internet(),
            self.check_ollama(ollama_url)
        )
        
        return {
            "internet": internet,
            "ollama": ollama,
            "timestamp": asyncio.get_event_loop().time()
        }