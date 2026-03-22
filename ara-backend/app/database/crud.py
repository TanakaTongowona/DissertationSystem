# app/database/crud.py
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, and_, desc
from typing import Optional, List, Dict, Any
from app.database import models
from datetime import datetime

# ========== Book CRUD Operations ==========


def get_book(db: Session, book_id: int):
    """Get a single book by ID"""
    return db.query(models.Book).filter(models.Book.id == book_id).first()


def get_book_by_path(db: Session, file_path: str):
    """Get a book by file path"""
    return db.query(models.Book).filter(models.Book.file_path == file_path).first()


def get_books(
    db: Session,
    skip: int = 0,
    limit: int = None,
    author: Optional[str] = None,
    search_term: Optional[str] = None,
):
    """Get books with optional filtering"""
    query = db.query(models.Book)

    if author:
        query = query.filter(models.Book.author.ilike(f"%{author}%"))

    if search_term:
        query = query.filter(
            or_(
                models.Book.title.ilike(f"%{search_term}%"),
                models.Book.content.ilike(f"%{search_term}%"),
            )
        )

    return query.offset(skip).limit(limit).all()


def create_book(
    db: Session,
    title: str,
    file_path: str,
    file_size: int,
    date_published: Optional[datetime] = None,
    author: Optional[str] = None,
    metadata_json: Optional[Dict] = None,
):
    """Create a new book record"""
    book = models.Book(
        title=title,
        author=author,
        file_path=file_path,
        date_published=date_published,
        file_size=file_size,
        metadata_json=metadata_json or {},
    )
    db.add(book)
    db.commit()
    db.refresh(book)
    return book


def update_book(db: Session, book_id: int, updates: Dict[str, Any]):
    """Update a book's information"""
    book = get_book(db, book_id)
    if not book:
        return None

    for key, value in updates.items():
        if hasattr(book, key):
            setattr(book, key, value)

    db.commit()
    db.refresh(book)
    return book


def update_book_embedding(
    db: Session, book_id: int, embedding: List[float], content: str
):
    """Update a book's embedding and content after processing"""
    book = get_book(db, book_id)
    if book:
        book.embedding = embedding
        book.content = content
        db.commit()
        db.refresh(book)
    return book


def delete_book(db: Session, book_id: int):
    """Delete a book record"""
    book = get_book(db, book_id)
    if book:
        db.delete(book)
        db.commit()
        return True
    return False


def count_books(db: Session) -> int:
    """Count total books"""
    return db.query(func.count(models.Book.id)).scalar()


def count_indexed_books(db: Session) -> int:
    """Count books that have been indexed (have embeddings)"""
    return (
        db.query(func.count(models.Book.id))
        .filter(models.Book.embedding.isnot(None))
        .scalar()
    )


def get_total_size(db: Session) -> Optional[int]:
    """Get total size of all books in bytes"""
    result = db.query(func.sum(models.Book.file_size)).scalar()
    return result if result else 0


def get_recent_books(db: Session, limit: int = 10):
    """Get most recently added books"""
    return (
        db.query(models.Book).order_by(models.Book.created_at.desc()).limit(limit).all()
    )


def search_books_by_similarity(db: Session, query_embedding: list, limit: int = 10):
    """Search books by embedding similarity using pgvector"""
    from app.database.models import Book

    # Don't convert to Vector here - pass the list directly
    # The SQLAlchemy pgvector extension will handle the conversion

    books = (
        db.query(
            Book.id,
            Book.title,
            Book.author,
            Book.file_path,
            Book.content,
            (1 - Book.embedding.cosine_distance(query_embedding)).label("similarity"),
        )
        .filter(Book.embedding.isnot(None))
        .order_by(Book.embedding.cosine_distance(query_embedding))
        .limit(limit)
        .all()
    )

    # Convert to list of dicts
    results = []
    for book in books:
        results.append(
            {
                "id": book.id,
                "title": book.title,
                "author": book.author,
                "file_path": book.file_path,
                "content": book.content,
                "similarity": float(book.similarity) if book.similarity else 0,
            }
        )

    return results


# ========== Research Session CRUD ==========


def create_research_session(
    db: Session,
    query: str,
    plan: Optional[str] = None,
    answer: Optional[str] = None,
    sources: Optional[List[Dict]] = None,
    provider_used: Optional[List[Dict]] = None,
):
    """Create a new research session"""
    session = models.ResearchSession(
        query=query,
        plan=plan,
        answer=answer,
        sources=sources or [],
        provider_used=provider_used or [],
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def get_research_session(db: Session, session_id: int):
    """Get a research session by ID"""
    return (
        db.query(models.ResearchSession)
        .filter(models.ResearchSession.id == session_id)
        .first()
    )


def get_research_sessions(
    db: Session, skip: int = 0, limit: int = 50, completed_only: bool = False
):
    """Get research sessions with optional filtering"""
    query = db.query(models.ResearchSession)

    if completed_only:
        query = query.filter(models.ResearchSession.completed_at.isnot(None))

    return (
        query.order_by(models.ResearchSession.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


def update_research_session(
    db: Session,
    session_id: int,
    answer: str,
    sources: List[Dict],
    provider_used: List[Dict],
):
    """Update a research session with results"""
    session = get_research_session(db, session_id)
    if session:
        session.answer = answer
        session.sources = sources
        session.provider_used = provider_used
        session.completed_at = func.now()
        db.commit()
        db.refresh(session)
    return session


def delete_research_session(db: Session, session_id: int):
    """Delete a research session"""
    session = get_research_session(db, session_id)
    if session:
        db.delete(session)
        db.commit()
        return True
    return False


def count_research_sessions(db: Session) -> int:
    """Count total research sessions"""
    return db.query(func.count(models.ResearchSession.id)).scalar()


def get_recent_queries(db: Session, limit: int = 10):
    """Get most recent research queries"""
    return (
        db.query(models.ResearchSession)
        .order_by(models.ResearchSession.created_at.desc())
        .limit(limit)
        .all()
    )


# ========== Statistics and Analytics ==========


def get_library_statistics(db: Session) -> Dict:
    """Get comprehensive library statistics"""
    total_books = count_books(db)
    indexed_books = count_indexed_books(db)
    total_size = get_total_size(db)

    # Get authors count
    authors_count = (
        db.query(func.count(func.distinct(models.Book.author)))
        .filter(models.Book.author.isnot(None))
        .scalar()
    )

    # Get books by author (top 10)
    top_authors = (
        db.query(models.Book.author, func.count(models.Book.id).label("book_count"))
        .filter(models.Book.author.isnot(None))
        .group_by(models.Book.author)
        .order_by(func.count(models.Book.id).desc())
        .limit(10)
        .all()
    )

    return {
        "total_books": total_books,
        "indexed_books": indexed_books,
        "pending_indexing": total_books - indexed_books,
        "total_size_mb": round(total_size / (1024 * 1024), 2) if total_size else 0,
        "unique_authors": authors_count,
        "top_authors": [{"name": a[0], "count": a[1]} for a in top_authors],
        "indexing_progress": (
            round((indexed_books / total_books * 100), 2) if total_books > 0 else 0
        ),
    }


def get_research_statistics(db: Session) -> Dict:
    """Get statistics about research sessions"""
    total_sessions = count_research_sessions(db)

    # Sessions in last 7 days
    from datetime import datetime, timedelta

    week_ago = datetime.now() - timedelta(days=7)

    recent_sessions = (
        db.query(func.count(models.ResearchSession.id))
        .filter(models.ResearchSession.created_at >= week_ago)
        .scalar()
    )

    # Most common providers used
    # Note: This is more complex as provider_used is JSON
    # You might want to track this differently or parse JSON in application

    return {
        "total_research_sessions": total_sessions,
        "sessions_last_7_days": recent_sessions,
        "avg_response_time_ms": None,  # Would need to track timing
        "unique_queries": db.query(
            func.count(func.distinct(models.ResearchSession.query))
        ).scalar(),
    }


def get_top_authors(
    db: Session,
    limit: int = 10,
    min_books: int = 1,
    sort_by: str = "book_count",  # Options: "book_count", "total_size", "latest_book"
    author_filter: Optional[str] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    include_metadata: bool = False,
) -> List[Dict[str, Any]]:
    """
    Fetch top authors from the books table with various statistics.

    Args:
        db: SQLAlchemy database session
        limit: Maximum number of authors to return
        min_books: Minimum number of books an author must have
        sort_by: Sorting criteria ('book_count', 'total_size', 'latest_book')
        author_filter: Optional filter for author name (partial match)
        date_from: Only include books created after this date
        date_to: Only include books created before this date
        include_metadata: Whether to include sample book metadata

    Returns:
        List of dictionaries with author statistics
    """

    # Build base query
    query = db.query(
        models.Book.author,
        func.count(models.Book.id).label("book_count"),
        func.sum(models.Book.file_size).label("total_size"),
        func.avg(models.Book.file_size).label("avg_size"),
        func.max(models.Book.created_at).label("latest_book_date"),
        func.min(models.Book.created_at).label("first_book_date"),
        func.array_agg(models.Book.id).label("book_ids"),
    )

    # Apply filters
    filters = []

    # Filter out NULL authors
    filters.append(models.Book.author.isnot(None))
    filters.append(models.Book.author != "")

    if author_filter:
        filters.append(models.Book.author.ilike(f"%{author_filter}%"))

    if date_from:
        filters.append(models.Book.created_at >= date_from)

    if date_to:
        filters.append(models.Book.created_at <= date_to)

    # Apply all filters
    query = query.filter(and_(*filters))

    # Group by author
    query = query.group_by(models.Book.author)

    # Filter authors with minimum number of books
    query = query.having(func.count(models.Book.id) >= min_books)

    # Apply sorting
    if sort_by == "book_count":
        query = query.order_by(desc("book_count"))
    elif sort_by == "total_size":
        query = query.order_by(desc("total_size"))
    elif sort_by == "latest_book":
        query = query.order_by(desc("latest_book_date"))
    else:
        query = query.order_by(desc("book_count"))

    # Apply limit
    query = query.limit(limit)

    # Execute query
    results = query.all()

    # Format results
    top_authors = []
    for author in results:
        author_data = {
            "author": author.author,
            "book_count": author.book_count,
            "total_size_bytes": author.total_size,
            "total_size_mb": (
                round(author.total_size / (1024 * 1024), 2) if author.total_size else 0
            ),
            "avg_size_bytes": int(author.avg_size) if author.avg_size else 0,
            "avg_size_mb": (
                round(author.avg_size / (1024 * 1024), 2) if author.avg_size else 0
            ),
            "latest_book_date": (
                author.latest_book_date.isoformat() if author.latest_book_date else None
            ),
            "first_book_date": (
                author.first_book_date.isoformat() if author.first_book_date else None
            ),
            "activity_span_days": (
                (author.latest_book_date - author.first_book_date).days
                if author.latest_book_date and author.first_book_date
                else 0
            ),
        }

        # Optionally include sample book metadata
        if include_metadata and author.book_ids:
            sample_books = (
                db.query(models.Book)
                .filter(models.Book.id.in_(author.book_ids[:3]))  # Get first 3 books
                .all()
            )
            author_data["sample_books"] = [book.to_dict() for book in sample_books]

        top_authors.append(author_data)

    return top_authors
