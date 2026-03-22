from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.schemas.external_books import ImportRequest, ExternalSearchRequest
from app.external_sources.factory import ConnectorFactory
from app.external_sources.models import ExternalBook
from app.auth_services import oauth2
from app.database import models
from app.tasks.import_tasks import import_book_background
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/external-books", tags=["external-books"])


@router.post("/search")
async def search_external_books(
    request: ExternalSearchRequest,
    current_user: models.User = Depends(oauth2.get_current_user)
):
    """
    Search for books across multiple external sources
    """
    all_results = []
    
    for source in request.sources:
        connector = ConnectorFactory.get_connector(source)
        if not connector:
            continue
        
        try:
            result = await connector.search(
                query=request.query,
                limit=request.limit,
                page=request.page
            )
            
            all_results.append({
                "source": source,
                "total": result.total_results,
                "items": [book.dict() for book in result.items]
            })
        except Exception as e:
            logger.error(f"Error searching {source}: {e}")
            # Continue with other sources even if one fails
    
    return {"results": all_results}



@router.get("/isbn/{isbn}")
async def fetch_by_isbn(
    isbn: str,
    sources: str = Query("google_books,open_library", description="Comma-separated source list"),
    current_user: models.User = Depends(oauth2.get_current_user)
):
    """
    Fetch book by ISBN from multiple sources
    Returns the first successful result
    """
    source_list = [s.strip() for s in sources.split(",")]
    
    for source in source_list:
        connector = ConnectorFactory.get_connector(source)
        if not connector:
            continue
        
        try:
            book = await connector.fetch_by_isbn(isbn)
            if book:
                return {
                    "source": source,
                    "book": book.dict()
                }
        except Exception as e:
            logger.error(f"Error fetching ISBN {isbn} from {source}: {e}")
            continue
    
    raise HTTPException(status_code=404, detail="Book not found in any source")



@router.post("/import")
async def import_external_book(
    request: ImportRequest,
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db)
):
    """
    Import a book from external source into your library
    """
    # Get connector
    connector = ConnectorFactory.get_connector(request.source)
    if not connector:
        raise HTTPException(status_code=400, detail=f"Unknown source: {request.source}")
    
    try:
        # Fetch metadata if requested
        external_book = None
        if request.auto_fetch_metadata:
            external_book = await connector.fetch_by_id(request.source_id)
        
        if not external_book:
            # Create minimal record with provided info
            external_book = ExternalBook(
                source=request.source,
                source_id=request.source_id,
                title=request.title or "Unknown Title",
                authors=[request.author] if request.author else []
            )
        
        # Start background import task
        background_tasks.add_task(
            import_book_background,
            external_book.dict(),
            current_user.id
        )
        
        return {
            "message": "Book import started in background",
            "book": external_book.dict()
        }
        
    except Exception as e:
        logger.error(f"Error importing book: {e}")
        raise HTTPException(status_code=500, detail=str(e))



@router.get("/sources")
async def list_sources(
    current_user: models.User = Depends(oauth2.get_current_user)
):
    """List available external sources"""    
    sources = []
    for source_name, connector_class in ConnectorFactory._connectors.items():
        sources.append({
            "name": source_name,
            "description": get_source_description(source_name),
            "requires_api_key": source_name in ["google_books", "crossref"]
        })
    
    return {"sources": sources}



def get_source_description(source: str) -> str:
    descriptions = {
        "google_books": "Google Books - Comprehensive catalog with previews",
        "open_library": "Open Library - Free public domain books",
        "crossref": "CrossRef - Academic publications and citations"
    }
    return descriptions.get(source, source)