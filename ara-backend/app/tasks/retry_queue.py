# app/tasks/retry_queue.py
import asyncio
from typing import Dict
import logging

from app.database.session import SessionLocal
from app.agents.book_processor import BookProcessor

logger = logging.getLogger(__name__)

class RetryQueue:
    """
    Queue for retrying failed external book indexing
    """
    
    def __init__(self):
        self.queue = asyncio.Queue()
        self.retry_counts: Dict[int, int] = {}
        self.max_retries = 5
        self.base_delay = 60  # seconds
    
    async def add_book(self, book_id: int, delay_seconds: int = 60):
        """Add book to retry queue with delay"""
        await asyncio.sleep(delay_seconds)
        await self.queue.put(book_id)
        logger.info(f"Added book {book_id} to retry queue (will retry in {delay_seconds}s)")
    
    async def process_queue(self):
        """Process retry queue continuously"""
        while True:
            try:
                # Get next book from queue
                book_id = await self.queue.get()
                
                # Update retry count
                self.retry_counts[book_id] = self.retry_counts.get(book_id, 0) + 1
                retry_count = self.retry_counts[book_id]
                
                if retry_count > self.max_retries:
                    logger.error(f"Book {book_id} exceeded max retries ({self.max_retries})")
                    continue
                
                # Calculate backoff delay
                backoff = self.base_delay * (2 ** (retry_count - 1))  # Exponential backoff
                
                # Process the book
                logger.info(f"Retry attempt {retry_count} for book {book_id}")
                success = await self._process_book(book_id)
                
                if not success:
                    # Re-queue with backoff
                    asyncio.create_task(
                        self.add_book(book_id, backoff)
                    )
                
            except Exception as e:
                logger.error(f"Error in retry queue: {e}")
                await asyncio.sleep(10)
    
    async def _process_book(self, book_id: int) -> bool:
        """Process a single book"""
        db = SessionLocal()
        try:
            processor = BookProcessor(db)
            result = await processor.process_single_book(book_id, "")
            
            if result.get("indexed"):
                logger.info(f"Successfully indexed book {book_id} on retry")
                # Clear retry count on success
                if book_id in self.retry_counts:
                    del self.retry_counts[book_id]
                return True
            else:
                logger.warning(f"Retry attempt {self.retry_counts[book_id]} failed for book {book_id}")
                return False
                
        except Exception as e:
            logger.error(f"Error processing book {book_id} in retry queue: {e}")
            return False
        finally:
            await processor.close()
            db.close()

# Global retry queue instance
retry_queue = RetryQueue()

async def start_retry_queue():
    """Start the retry queue processor"""
    asyncio.create_task(retry_queue.process_queue())