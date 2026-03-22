from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from sqlalchemy.orm import Session
import asyncio
import logging
import uuid
from datetime import datetime
from app.database.session import get_db
from app.database.session import SessionLocal
from sqlalchemy import text
from app.external_sources.factory import ConnectorFactory
from app.auth_services import oauth2
from app.schemas.bulk_imports import BulkImportRequest, BulkImportResponse, BulkImportStatus
from app.database import models

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/bulk-imports", tags=["external-books"])

import_tasks = {}

@router.post("/bulk-import", response_model=BulkImportResponse)
async def bulk_import_books(
    request: BulkImportRequest,
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db)
):
    """
    Search for books and automatically import the first N results
    This runs in the background to avoid blocking
    """
    # Validate source
    connector = ConnectorFactory.get_connector(request.source)
    if not connector:
        raise HTTPException(status_code=400, detail=f"Unknown source: {request.source}")
    
    # Generate task ID for tracking
    task_id = str(uuid.uuid4())
    
    # Create task record
    import_tasks[task_id] = {
        "id": task_id,  # Keep as 'id' for compatibility with alias
        "query": request.query,
        "source": request.source,
        "status": "pending",
        "total_found": 0,
        "imported_count": 0,
        "failed_count": 0,
        "books": [],
        "errors": [],
        "created_at": datetime.now().isoformat(),
        "completed_at": None,
        "user_id": current_user.id
    }
    
    # Start background import
    background_tasks.add_task(
        process_bulk_import,
        task_id,
        request.query,
        request.source,
        request.count,
        request.max_results,
        current_user.id
    )
    
    return BulkImportResponse(
        task_id=task_id,
        query=request.query,
        source=request.source,
        requested_count=request.count,
        status="pending",
        message=f"Bulk import started. {request.count} books will be imported from {request.source}"
    )

@router.get("/status/{task_id}", response_model=BulkImportStatus)
async def get_bulk_import_status(
    task_id: str,
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db)
):
    """Check status of a bulk import task"""
    if task_id not in import_tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    
    task = import_tasks[task_id]
    
    # Verify ownership
    if task["user_id"] != current_user.id and not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not authorized to view this task")
    
    # No transformation needed - alias handles it
    return BulkImportStatus(**task)

@router.get("/bulk-import")
async def list_bulk_imports(
    current_user: models.User = Depends(oauth2.get_current_user),
    limit: int = Query(10, ge=1, le=50)
):
    """List recent bulk import tasks for the current user"""
    user_tasks = [
        task for task_id, task in import_tasks.items()
        if task["user_id"] == current_user.id
    ]
    
    # Sort by created_at descending
    user_tasks.sort(key=lambda x: x["created_at"], reverse=True)
    
    return {"tasks": user_tasks[:limit]}

# Background processing function
async def process_bulk_import(
    task_id: str,
    query: str,
    source: str,
    count: int,
    max_results: int,
    user_id: int
):
    """
    Background task to search and import multiple books
    """
    db = None
    try:
        db = SessionLocal()
        
        # Update task status
        import_tasks[task_id]["status"] = "processing"
        
        # Get connector
        connector = ConnectorFactory.get_connector(source)
        if not connector:
            import_tasks[task_id]["status"] = "failed"
            import_tasks[task_id]["errors"].append(f"Unknown source: {source}")
            return
        
        # Step 1: Search for books
        logger.info(f"Searching {source} for: {query}")
        search_result = await connector.search(query, limit=max_results)
        
        total_found = search_result.total_results
        books_to_import = search_result.items[:count]
        
        import_tasks[task_id]["total_found"] = total_found
        import_tasks[task_id]["books"] = [b.dict() for b in books_to_import]
        
        logger.info(f"Found {total_found} books, importing first {len(books_to_import)}")
        
        # Step 2: Import each book
        imported = 0
        failed = 0
        
        for i, book in enumerate(books_to_import):
            try:
                # Initialize existing to None before any conditions
                existing = None

                if book.isbn:
                    result = db.execute(
                        text("SELECT * FROM books WHERE metadata_json->>'isbn' = :isbn LIMIT 1"),
                        {"isbn": book.isbn}
                    )
                    existing = result.first()

                # Now existing is always defined (at least None)
                if not existing and book.source_id:
                    result = db.execute(
                        text("SELECT * FROM books WHERE metadata_json->>'source_id' = :source_id LIMIT 1"),
                        {"source_id": book.source_id}
                    )
                    existing = result.first()
                
                if existing:
                    logger.info(f"Book already exists: {book.title}")
                    # Still count as "imported" for tracking
                    imported += 1
                    continue

                # Create new book
                new_book = models.Book(
                    title=book.title,
                    author=", ".join(book.authors) if book.authors else None,
                    file_path=book.info_url,  # Unique for each book
                    file_size=0,
                    content=book.description,
                    metadata_json={
                        "source": book.source,
                        "source_id": book.source_id,
                        "isbn": book.isbn,
                        "isbn13": book.isbn13,
                        "doi": book.doi,
                        "publishers": book.publishers,
                        "published_date": str(book.published_date) if book.published_date else None,
                        "pages": book.pages,
                        "language": book.language,
                        "subjects": book.subjects,
                        "description": book.description,
                        "external_urls": {
                            "info": book.info_url,
                            "preview": book.preview_url,
                            "thumbnail": book.thumbnail_url
                        }
                    },
                    external_source=book.source,
                    external_id=book.source_id,
                    isbn=book.isbn,
                    isbn13=book.isbn13,
                    doi=book.doi,
                    description=book.description,
                    date_published=book.published_date
                )
                
                db.add(new_book)
                db.commit()
                imported += 1
                
                # Update task progress
                import_tasks[task_id]["imported_count"] = imported
                
                # Small delay to avoid rate limiting
                if i < len(books_to_import) - 1:
                    await asyncio.sleep(0.5)
                    
            except Exception as e:
                logger.error(f"Failed to import book {book.title}: {e}")
                failed += 1
                import_tasks[task_id]["errors"].append(f"{book.title}: {str(e)}")
                db.rollback()
        
        # Update final status
        import_tasks[task_id]["status"] = "completed"
        import_tasks[task_id]["imported_count"] = imported
        import_tasks[task_id]["failed_count"] = failed
        import_tasks[task_id]["completed_at"] = datetime.now().isoformat()
        
        logger.info(f"Bulk import completed: {imported} imported, {failed} failed")
        
    except Exception as e:
        logger.error(f"Bulk import failed: {e}")
        if task_id in import_tasks:
            import_tasks[task_id]["status"] = "failed"
            import_tasks[task_id]["errors"].append(str(e))
            import_tasks[task_id]["completed_at"] = datetime.now().isoformat()
    finally:
        if db:
            db.close()