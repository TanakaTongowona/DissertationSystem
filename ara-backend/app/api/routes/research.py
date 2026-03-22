from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, status
from sqlalchemy.orm import Session
from typing import List, Optional
from app.auth_services import oauth2
from app.database.session import get_db
from app.agents.research_agent import ResearchAgent, ResearchMethod
from app.agents.book_processor import BookProcessor
from app.schemas.research import ResearchQuery, ResearchResponse, BookIndexResponse, IndexTriggerResponse, ResearchSessionResponse
from app.database import models
import logging
from pathlib import Path
from app.config import get_settings
import uuid

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/research", tags=["research"])

@router.post("/query", response_model=ResearchResponse)
async def research_query(
    query: ResearchQuery,  # Make sure your ResearchQuery schema includes method and top_k
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db)
):
    """Perform deep research with method selection and date range filtering"""
    try:
        agent = ResearchAgent(db)
        result = await agent.research(
            query=query.query, 
            method=query.method or ResearchMethod.ALL,
            owner_id=current_user.id,
            top_k=query.top_k or 5,
            start_date=query.start_date,
            end_date=query.end_date  # Add end_date parameter
        )
        return result
    except Exception as e:
        logger.error(f"Research failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/session/{session_id}", response_model=ResearchSessionResponse)
async def get_research_session(
    session_id: int,
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db)
):
    """Retrieve a previous research session"""
    # Get the session
    session = db.query(models.ResearchSession).filter(
        models.ResearchSession.id == session_id
    ).first()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # Check permissions: user must be superuser OR the owner of the session
    if not current_user.is_superuser and session.owner_id != current_user.id:
        raise HTTPException(
            status_code=403, 
            detail="Not authorized to access this session"
        )
    
    return {
        "owner_id": session.owner_id,
        "owner": session.owner,
        "id": session.id,
        "query": session.query,
        "plan": session.plan,
        "answer": session.answer,
        "sources": session.sources or [],
        "provider_log": session.provider_used or [],
        "research_method": session.research_method,
        "confidence": session.confidence,
        "source_type": session.source_type,
        "created_at": session.created_at,
        "status": "completed" if session.completed_at else "pending"
    }


@router.get("/sessions", response_model=List[ResearchSessionResponse])
async def get_research_sessions(
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 100
):
    """Retrieve all research sessions for the current user (or all if superuser)"""
    # Build query based on user permissions
    query = db.query(models.ResearchSession)
    
    # If not superuser, filter by owner_id
    if not current_user.is_superuser:
        query = query.filter(models.ResearchSession.owner_id == current_user.id)
    
    # Get sessions with pagination
    sessions = query.order_by(models.ResearchSession.created_at.desc()).offset(skip).limit(limit).all()
    
    # Format response for each session
    return [
        {
            "owner_id": session.owner_id,
            "owner": session.owner,
            "id": session.id,
            "query": session.query,
            "plan": session.plan,
            "answer": session.answer,
            "sources": session.sources or [],
            "provider_log": session.provider_used or [],
            "research_method": session.research_method,
            "confidence": session.confidence,
            "source_type": session.source_type,
            "created_at": session.created_at,
            "status": "completed" if session.completed_at else "pending"
        }
        for session in sessions
    ]



@router.post("/books/index", response_model=IndexTriggerResponse)
async def trigger_indexing(
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db)
):
    """Trigger background indexing of all books (Superuser only)"""
    # Superuser check
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only superusers can trigger bulk indexing",
        )
    
    processor = BookProcessor(db)
    
    # Count PDFs
    
    settings = get_settings()
    book_folder = Path(settings.BOOKS_FOLDER)
    pdf_files = list(book_folder.glob("*.pdf"))
    
    # Generate task ID for tracking
    task_id = str(uuid.uuid4())
    
    # Run in background
    background_tasks.add_task(processor.index_all_books)
    
    return IndexTriggerResponse(
        message=f"Started indexing {len(pdf_files)} books",
        books_queued=len(pdf_files),
        task_id=task_id,
        status="processing"
    )


@router.get("/books/index/status", response_model=List[BookIndexResponse])
async def get_indexing_status(
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db)
):
    """Get the current indexing status of all books"""
    # All authenticated users can view indexing status
    books = db.query(models.Book).all()
    
    results = []
    for book in books:
        results.append(BookIndexResponse(
            title=book.title,
            file_path=book.file_path,
            indexed=book.embedding is not None,
            content_length=len(book.content) if book.content else 0
        ))
    
    return results



@router.post("/books/index/{filename}")
async def index_single_book(
    filename: str,
    title: Optional[str] = None,
    author: Optional[str] = None,
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db)
):
    """Index a single book by filename (Superuser only)"""
    # Superuser check
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only superusers can manually index books",
        )
    
    file_path = f"./books/{filename}"
    processor = BookProcessor(db)
    
    try:
        result = processor.index_book(file_path, title, author)
        return result
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Book file not found")
    

@router.delete("/session/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_research_session(
    session_id: int,
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a research session"""
    # Get the session
    session = db.query(models.ResearchSession).filter(
        models.ResearchSession.id == session_id
    ).first()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # Check permissions: user must be superuser OR the owner of the session
    if not current_user.is_superuser and session.owner_id != current_user.id:
        raise HTTPException(
            status_code=403, 
            detail="Not authorized to delete this session"
        )
    
    # Delete the session
    db.delete(session)
    db.commit()
    
    return None