from typing import List, Optional
from pydantic import BaseModel, Field

class BulkImportRequest(BaseModel):
    query: str
    source: str = "google_books"  # Default source
    count: int = 10  # Number of books to import
    max_results: int = 20  # Max to fetch from API (should be >= count)
    auto_start: bool = True  # Whether to start import immediately

class BulkImportResponse(BaseModel):
    task_id: str
    query: str
    source: str
    requested_count: int
    status: str
    message: str

class BulkImportStatus(BaseModel):
    task_id: str = Field(..., alias='id')  # Accept 'id' from dict as task_id
    status: str
    total_found: int
    imported_count: int
    source: str
    failed_count: int
    books: List[dict]
    errors: List[str]
    created_at: str
    completed_at: Optional[str]
    user_id: int
    
    class Config:
        populate_by_name = True  # ✅ Allow both 'task_id' and 'id' to work