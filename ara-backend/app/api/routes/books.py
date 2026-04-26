from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    UploadFile,
    File,
    BackgroundTasks,
    Query,
    status,
    Form,
)
import random
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
import os
from fastapi.responses import FileResponse
import shutil
from app.agents.ml_engine import MLEngine
import numpy as np
from pathlib import Path
from app.agents.book_processor import BookProcessor
from app.api.routes.ml import extract_ml_features_for_book
from app.schemas.books import BookResponse, BookDetailResponse, BookSearchQuery
from app.database.session import get_db
from app.database import crud
from app.database.session import SessionLocal
from app.tasks.retry_queue import retry_queue
from app.config import get_settings
from app.database import models
from app.auth_services import oauth2
import logging
import asyncio
import joblib


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/books", tags=["books"])


@router.get("/all", response_model=List[BookResponse])
async def get_all_books(
    skip: int = Query(0, ge=0),
    limit: int = Query(None, ge=1, le=1000),
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db),
):
    """Get all books with pagination"""
    # All authenticated users can view books

    books = crud.get_books(db, skip=skip, limit=limit)
    results = []

    for book in books:
        results.append(
            BookResponse(
                id=book.id,
                title=book.title,
                author=book.author,
                file_path=book.file_path,
                file_size=book.file_size,
                date_published=book.date_published,
                indexed=book.embedding
                is not None,  # or book.indexed if you have that field
                metadata_json=book.metadata_json,
                created_at=book.created_at,
            )
        )
    return results


@router.get("/{book_id}", response_model=BookDetailResponse)
async def get_book(
    book_id: int,
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db),
):
    """Get detailed information about a specific book"""
    # All authenticated users can view book details
    book = crud.get_book(db, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    # Add preview and status
    response = BookDetailResponse(
        **book.__dict__,
        content_preview=(
            book.content[:500] + "..."
            if book.content and len(book.content) > 500
            else book.content
        ),
        embedding_status="indexed" if book.embedding is not None else "pending",
    )
    return response


@router.get("/{book_id}/download")
async def download_book(
    book_id: int,
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db),
):
    """Download a book file"""
    book = crud.get_book(db, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    # Check if file exists
    file_path = Path(book.file_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on server")

    # Get filename from path
    filename = os.path.basename(book.file_path)

    # Return file as download with proper headers
    return FileResponse(
        path=file_path,
        filename=filename,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


@router.post("/upload", response_model=BookResponse)
async def upload_book(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),  # Note: Form, not Body
    author: Optional[str] = Form(None),
    date_published: Optional[str] = Form(None),
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db),
):
    """Upload a new PDF book and index it (Superuser only)"""
    # Superuser check
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only superusers can upload books",
        )

    print("=" * 50)
    print("UPLOAD REQUEST RECEIVED")
    print(f"Filename: {file.filename}")
    print(f"Title: {title}")
    print(f"Author: {author}")
    print(f"Date published: {date_published}")
    print(f"Date published type: {type(date_published)}")
    print("=" * 50)

    settings = get_settings()

    # Validate file type
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    # Check file size
    file.file.seek(0, 2)
    file_size = file.file.tell()
    file.file.seek(0)

    if file_size > settings.MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Max size: {settings.MAX_UPLOAD_SIZE / (1024*1024)}MB",
        )

    # Create uploads folder
    upload_dir = Path(settings.UPLOAD_FOLDER)
    upload_dir.mkdir(exist_ok=True)

    # Save file
    file_path = upload_dir / file.filename
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # Create book record
    book = crud.create_book(
        db,
        title=title or file.filename,
        author=author,
        date_published=date_published,
        file_path=str(file_path),
        file_size=file_size,
    )

    # Start indexing in background
    background_tasks.add_task(process_and_index_book, book.id, str(file_path), db)

    # Let Pydantic handle the conversion
    return book


@router.post("/reindex-all-unindexed")
async def reindex_all_unindexed_books(
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db),
):
    """Reindex all books that are not currently indexed (Superuser only)

    This will:
    1. Find all books without embeddings
    2. Start background indexing for each book
    3. Return count of books queued for indexing
    """
    # Superuser check
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only superusers can reindex books",
        )

    # Find all books without embeddings (not indexed)
    unindexed_books = (
        db.query(models.Book).filter(models.Book.embedding.is_(None)).all()
    )

    if not unindexed_books:
        return {"message": "No unindexed books found", "total_queued": 0}

    # Track counts for response
    local_books_queued = 0
    external_books_queued = 0
    failed_books = []

    for book in unindexed_books:
        try:
            # Check if it's an external book
            is_external = book.metadata_json and book.metadata_json.get("source") in [
                "google_books",
                "open_library",
                "crossref",
            ]

            if is_external:
                # External book - queue for indexing
                background_tasks.add_task(process_external_book_indexing, book.id, db)
                external_books_queued += 1
            else:
                # Local PDF book - check file exists before queueing
                if not os.path.exists(book.file_path):
                    failed_books.append(
                        {
                            "id": book.id,
                            "title": book.title,
                            "reason": "File not found on disk",
                        }
                    )
                    continue

                background_tasks.add_task(
                    process_and_index_book, book.id, book.file_path, db
                )
                local_books_queued += 1

        except Exception as e:
            failed_books.append({"id": book.id, "title": book.title, "reason": str(e)})

    total_queued = local_books_queued + external_books_queued

    response = {
        "message": f"Indexing started for {total_queued} books",
        "total_queued": total_queued,
        "local_books_queued": local_books_queued,
        "external_books_queued": external_books_queued,
    }

    if failed_books:
        response["failed_books"] = failed_books
        response["total_failed"] = len(failed_books)

    return response


@router.post("/{book_id}/reindex")
async def reindex_book(
    book_id: int,
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db),
):
    """Reindex a book (extract text and generate embedding) (Superuser only)

    Supports:
    - Local PDF books: extracts text from file_path
    - External books (Google Books, etc.): fetches content from API/preview URL
    """
    # Superuser check
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only superusers can reindex books",
        )

    book = crud.get_book(db, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    # Check if it's an external book
    is_external = book.metadata_json and book.metadata_json.get("source") in [
        "google_books",
        "open_library",
        "crossref",
    ]

    if is_external:
        # External book - no file path check needed
        background_tasks.add_task(
            process_external_book_indexing,
            book.id,
            db,  # Note: Need new session for background task
        )
        return {"message": f"External book indexing started for {book.title}"}

    else:
        # Local PDF book - check file exists
        if not os.path.exists(book.file_path):
            raise HTTPException(status_code=404, detail="Book file not found on disk")

        background_tasks.add_task(process_and_index_book, book.id, book.file_path, db)

        return {"message": f"Reindexing started for book {book.title}"}


# Update the background task function


async def process_external_book_indexing(book_id: int, db: Session):
    """Background task to process and index an external book with retry logic"""

    # Create new session for background task
    db = SessionLocal()
    try:
        processor = BookProcessor(db)
        result = await processor.process_single_book(book_id, "")

        if result.get("indexed"):
            logger.info(f"External indexing complete for book {book_id}")
        else:
            # Check if it was a rate limit issue
            book = db.query(models.Book).filter(models.Book.id == book_id).first()
            if book and book.metadata_json:
                source = book.metadata_json.get("source")
                if source == "google_books":
                    # Add to retry queue with initial delay
                    await retry_queue.add_book(book_id, delay_seconds=300)  # 5 minutes
                    logger.info(
                        f"Added book {book_id} to retry queue due to rate limit"
                    )
                else:
                    logger.warning(
                        f"External indexing failed for book {book_id}: {result}"
                    )

    except Exception as e:
        logger.error(f"Error indexing external book {book_id}: {e}")
        import traceback

        traceback.print_exc()

        # Add to retry queue on exception
        await retry_queue.add_book(book_id, delay_seconds=60)

    finally:
        await processor.close()
        db.close()


@router.patch("/{book_id}/metadata", response_model=BookResponse)
async def update_book_metadata(
    book_id: int,
    title: Optional[str] = None,
    author: Optional[str] = None,
    date_published: Optional[str] = None,  # Change to str
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db),
):
    """Update book metadata (Superuser only)"""
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only superusers can update book metadata",
        )

    book = db.query(models.Book).filter(models.Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    # Update only provided fields
    if title is not None:
        book.title = title
    if author is not None:
        book.author = author
    if date_published is not None:
        # Parse the date string to datetime
        try:
            # Handle different date formats
            if "T" in date_published:
                book.date_published = datetime.fromisoformat(date_published)
            else:
                # Assume YYYY-MM-DD format, set to midnight UTC
                book.date_published = datetime.fromisoformat(
                    f"{date_published}T00:00:00"
                )
        except ValueError:
            raise HTTPException(
                status_code=422, detail="Invalid date format. Use YYYY-MM-DD"
            )

    db.commit()
    db.refresh(book)

    return book


@router.post("/search", response_model=List[BookResponse])
async def search_books(
    search: BookSearchQuery,
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db),
):
    """Semantic search through books"""
    # All authenticated users can search books
    import logging

    logger = logging.getLogger(__name__)

    # Log the search query
    logger.info(
        f"Searching for: '{search.query}' with top_k={search.top_k}, min_similarity={search.min_similarity}"
    )

    processor = BookProcessor(db)

    # Generate and log query embedding
    query_embedding = processor.encoder.encode(search.query).tolist()
    logger.info(f"Query embedding generated, length: {len(query_embedding)}")

    # Search using embeddings
    results = processor.search_books(search.query, search.top_k)

    # Log raw results before filtering
    logger.info(f"Raw results count: {len(results)}")
    for i, r in enumerate(results):
        logger.info(f"Result {i+1}: {r['title']} - similarity: {r['similarity']}")

    # Filter by minimum similarity
    results = [r for r in results if r["similarity"] >= search.min_similarity]

    return results


@router.post("/search-ml-enhanced", response_model=List[BookDetailResponse])
async def search_books_ml_enhanced(
    search: BookSearchQuery,
    use_popularity_ranking: bool = True,
    use_recommendations: bool = False,
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db),
):
    """
    ML-enhanced search - separate endpoint that doesn't affect regular search
    Uses popularity model to rank results
    """

    # Use existing search functionality
    processor = BookProcessor(db)
    results = processor.search_books(search.query, search.top_k * 2)

    if use_popularity_ranking:
        # Load popularity model if available
        pop_model = (
            db.query(models.MLModel)
            .filter(
                models.MLModel.name == "book_popularity_regressor",
                models.MLModel.status.in_(["ready", "active"]),
            )
            .order_by(models.MLModel.created_at.desc())
            .first()
        )

        if pop_model:
            ml_engine = MLEngine(db)

            # Add popularity scores
            for result in results:
                # Get or extract features for this book
                book = (
                    db.query(models.Book).filter(models.Book.id == result["id"]).first()
                )

                if book:
                    features = await extract_ml_features_for_book(book, db)
                    prediction = ml_engine.predict(pop_model.id, features)
                    result["popularity_score"] = prediction.get("prediction", 0)

            # Sort by popularity
            results.sort(key=lambda x: x.get("popularity_score", 0), reverse=True)

    # Filter and limit
    results = [r for r in results if r["similarity"] >= search.min_similarity][
        : search.top_k
    ]

    return results


@router.get("/{book_id}/recommendations", response_model=List[BookDetailResponse])
async def get_book_recommendations(
    book_id: int,
    limit: int = Query(5, ge=1, le=20),
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db),
):
    """
    Get book recommendations based on ML clustering
    """
    
    # Get the book
    book = db.query(models.Book).filter(models.Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    
    logger.info(f"Getting recommendations for book: {book.title} (ID: {book_id})")
    
    # Extract keywords from the target book's title and metadata
    target_keywords = extract_keywords_from_book(book)
    logger.info(f"Extracted keywords from target book: {target_keywords}")
    
    # Load clustering model
    cluster_model = (
        db.query(models.MLModel)
        .filter(
            models.MLModel.name == "book_clustering",
            models.MLModel.status.in_(["ready", "active"]),
        )
        .order_by(models.MLModel.created_at.desc())
        .first()
    )
    
    if not cluster_model:
        logger.warning("No clustering model found")
        return await get_simple_recommendations(book_id, limit, db, target_keywords)
    
    logger.info(f"Found clustering model: ID={cluster_model.id}, name={cluster_model.name}, status={cluster_model.status}")
    logger.info(f"Model file path: {cluster_model.file_path}")
    logger.info(f"Feature names count from DB: {len(cluster_model.feature_names) if cluster_model.feature_names else 0}")
    
    ml_engine = MLEngine(db)
    
    # Load model data with better error handling
    try:
        model_data = ml_engine.load_model(cluster_model.id)
        
        if not model_data:
            logger.error(f"Failed to load model data for model {cluster_model.id}")
            # Try to load directly from file as fallback
            try:
                logger.info(f"Attempting direct load from {cluster_model.file_path}")
                model_data = joblib.load(cluster_model.file_path)
                logger.info(f"Direct load successful, keys: {model_data.keys()}")
            except Exception as direct_error:
                logger.error(f"Direct load also failed: {direct_error}")
                return await get_simple_recommendations(book_id, limit, db, target_keywords)
        
        logger.info(f"Loaded model data keys: {model_data.keys()}")
        
        # Get feature names from model data or database
        if 'feature_names' in model_data:
            feature_names = model_data['feature_names']
            logger.info(f"Feature names from model: {len(feature_names)} features")
        elif cluster_model.feature_names:
            feature_names = cluster_model.feature_names
            logger.info(f"Feature names from DB: {len(feature_names)} features")
        else:
            logger.error("No feature names found in model or database")
            return await get_simple_recommendations(book_id, limit, db, target_keywords)
        
        # Get all books with content for clustering
        all_books = (
            db.query(models.Book)
            .filter(
                models.Book.content.isnot(None),
                models.Book.content != "",
                models.Book.embedding.isnot(None),
            )
            .all()
        )
        
        logger.info(f"Found {len(all_books)} books with content and embeddings")
        
        if len(all_books) < 2:
            logger.warning("Not enough books for recommendations")
            return await get_simple_recommendations(book_id, limit, db, target_keywords)
        
        # Extract features
        features_df = ml_engine.extract_book_features(all_books)
        logger.info(f"Extracted features shape: {features_df.shape}")
        
        # Create text features
        tfidf_features, _, book_ids = ml_engine.create_text_features(all_books, max_features=200)
        logger.info(f"TF-IDF features shape: {tfidf_features.shape}")
        
        if tfidf_features.shape[0] == 0:
            logger.warning("No TF-IDF features extracted")
            return await get_simple_recommendations(book_id, limit, db, target_keywords)
        
        # Get numerical features
        numerical_features = features_df[['word_count', 'avg_word_length', 'file_size_mb']].values
        
        # CRITICAL: Match the exact feature count from the model
        expected_total_features = len(feature_names)
        expected_tfidf_features = expected_total_features - 3  # Subtract the 3 numerical features
        
        logger.info(f"Expected total features: {expected_total_features}")
        logger.info(f"Expected TF-IDF features: {expected_tfidf_features}")
        logger.info(f"Current TF-IDF features: {tfidf_features.shape[1]}")
        
        # Adjust TF-IDF features to match model expectations
        if tfidf_features.shape[1] < expected_tfidf_features:
            # Pad with zeros
            logger.info(f"Padding TF-IDF from {tfidf_features.shape[1]} to {expected_tfidf_features}")
            padded_tfidf = np.zeros((tfidf_features.shape[0], expected_tfidf_features))
            padded_tfidf[:, :tfidf_features.shape[1]] = tfidf_features
            tfidf_features = padded_tfidf
        elif tfidf_features.shape[1] > expected_tfidf_features:
            # Truncate to match
            logger.info(f"Truncating TF-IDF from {tfidf_features.shape[1]} to {expected_tfidf_features}")
            tfidf_features = tfidf_features[:, :expected_tfidf_features]
        
        # Combine features
        X = np.hstack([numerical_features, tfidf_features])
        logger.info(f"Combined features shape: {X.shape}")
        
        # Verify shape matches
        if X.shape[1] != expected_total_features:
            logger.error(f"Feature mismatch: got {X.shape[1]}, expected {expected_total_features}")
            return await get_simple_recommendations(book_id, limit, db, target_keywords)
        
        # Scale features if scaler exists
        if "scaler" in model_data and model_data["scaler"] is not None:
            try:
                X_scaled = model_data["scaler"].transform(X)
                logger.info("Features scaled successfully")
            except Exception as e:
                logger.error(f"Error scaling features: {e}")
                X_scaled = X
        else:
            logger.warning("No scaler in model data, using unscaled features")
            X_scaled = X
        
        # Get cluster predictions
        model = model_data["model"]
        clusters = model.predict(X_scaled)
        logger.info(f"Got clusters for {len(clusters)} books")
        
        # Log cluster distribution
        unique_clusters, counts = np.unique(clusters, return_counts=True)
        for cluster, count in zip(unique_clusters, counts):
            logger.info(f"Cluster {cluster}: {count} books")
        
        # Find target book
        target_index = None
        for i, b in enumerate(all_books):
            if b.id == book_id:
                target_index = i
                break
        
        if target_index is None:
            logger.warning(f"Book {book_id} not found in filtered books list")
            return await get_simple_recommendations(book_id, limit, db, target_keywords)
        
        target_cluster = clusters[target_index]
        logger.info(f"Target book in cluster {target_cluster}")
        
        # Find and score recommendations in same cluster with keyword matching
        cluster_books = []
        for i, b in enumerate(all_books):
            if b.id != book_id and clusters[i] == target_cluster:
                # Calculate keyword relevance score
                relevance_score = calculate_keyword_relevance(b, target_keywords)
                cluster_books.append((b, relevance_score))
        
        logger.info(f"Found {len(cluster_books)} books in same cluster")
        
        # Use stratified random sampling with relevance bands
        recommendations = await get_stratified_recommendations(
            cluster_books, 
            limit, 
            target_keywords,
            db
        )
        
        # If we don't have enough, add from other clusters with keyword matching
        if len(recommendations) < limit:
            logger.info(f"Need {limit - len(recommendations)} more recommendations, checking other clusters")
            
            # Get remaining books not already in recommendations
            remaining_books = []
            for i, b in enumerate(all_books):
                if b.id != book_id and b not in recommendations:
                    # Calculate relevance score
                    relevance_score = calculate_keyword_relevance(b, target_keywords)
                    remaining_books.append((b, relevance_score))
            
            # Get more recommendations with stratified sampling
            more_recommendations = await get_stratified_recommendations(
                remaining_books,
                limit - len(recommendations),
                target_keywords,
                db,
                min_relevance_threshold=0.5  # Lower threshold for fallback
            )
            recommendations.extend(more_recommendations)
        
        logger.info(f"Final recommendations count: {len(recommendations)}")
        
        # Log recommendations with their scores
        for i, rec in enumerate(recommendations[:limit]):
            rec_score = calculate_keyword_relevance(rec, target_keywords)
            rec_keywords = extract_keywords_from_book(rec)
            logger.info(f"Recommendation {i+1}: {rec.title} (score: {rec_score:.2f}) - Keywords: {rec_keywords}")
        
        # Format response
        return [
            BookDetailResponse(
                id=rec.id,
                title=rec.title,
                author=rec.author,
                file_path=rec.file_path,
                file_size=rec.file_size,
                date_published=rec.date_published,
                indexed=rec.embedding is not None,
                metadata_json=rec.metadata_json,
                created_at=rec.created_at,
                content_preview=(
                    rec.content[:500] + "..."
                    if rec.content and len(rec.content) > 500
                    else rec.content
                ),
                embedding_status="indexed" if rec.embedding is not None else "pending",
            )
            for rec in recommendations
        ]
        
    except Exception as e:
        logger.error(f"Error in ML recommendations: {e}")
        import traceback
        traceback.print_exc()
        return await get_simple_recommendations(book_id, limit, db, target_keywords)


async def get_stratified_recommendations(
    scored_books, 
    limit, 
    target_keywords, 
    db,
    min_relevance_threshold=1.0
):
    """
    Select recommendations using stratified sampling based on relevance bands.
    This ensures:
    1. All recommendations meet a minimum relevance threshold
    2. Variety within each relevance band
    3. Higher relevance bands contribute more recommendations
    
    Returns:
        List of book objects
    """
    if not scored_books:
        return []
    
    # Filter out books below minimum threshold
    filtered_books = [(book, score) for book, score in scored_books if score >= min_relevance_threshold]
    
    if not filtered_books:
        logger.warning(f"No books found above relevance threshold {min_relevance_threshold}")
        return []
    
    # If we have fewer books than limit, just return all
    if len(filtered_books) <= limit:
        return [book for book, _ in filtered_books]
    
    # Define relevance bands
    # Band 1: High relevance (score >= 5)
    # Band 2: Medium-high relevance (score >= 3 and < 5)
    # Band 3: Medium relevance (score >= 1 and < 3)
    # Band 4: Low relevance (score < 1)
    
    bands = {
        'high': {'min_score': 5, 'max_score': float('inf'), 'weight': 0.5, 'books': []},
        'medium_high': {'min_score': 3, 'max_score': 5, 'weight': 0.3, 'books': []},
        'medium': {'min_score': 1, 'max_score': 3, 'weight': 0.15, 'books': []},
        'low': {'min_score': min_relevance_threshold, 'max_score': 1, 'weight': 0.05, 'books': []}
    }
    
    # Distribute books into bands
    for book, score in filtered_books:
        for band_name, band in bands.items():
            if band['min_score'] <= score < band['max_score']:
                band['books'].append((book, score))
                break
    
    # Log band distribution
    for band_name, band in bands.items():
        logger.info(f"Band {band_name}: {len(band['books'])} books available")
    
    # Calculate how many books to take from each band
    recommendations = []
    remaining_limit = limit
    
    # Process bands in order of weight (higher weight first)
    for band_name in ['high', 'medium_high', 'medium', 'low']:
        band = bands[band_name]
        if not band['books']:
            continue
        
        # Calculate number of books to take from this band
        if band_name == 'high' and remaining_limit > 0:
            # For high relevance band, we might take more if available
            band_take = min(len(band['books']), remaining_limit)
        else:
            # For other bands, take weighted proportion
            band_take = min(
                len(band['books']), 
                max(1, int(remaining_limit * band['weight']))
            )
        
        if band_take <= 0:
            continue
        
        # Randomly select books from this band
        # Use weighted random within the band to favor higher scores within the band
        if len(band['books']) <= band_take:
            # Take all books from this band
            selected_books = [book for book, _ in band['books']]
        else:
            # Use weighted random selection within the band
            weights = [score for _, score in band['books']]
            total_weight = sum(weights)
            probabilities = [w / total_weight for w in weights]
            
            selected_indices = set()
            while len(selected_indices) < band_take:
                idx = random.choices(range(len(band['books'])), weights=weights, k=1)[0]
                selected_indices.add(idx)
            
            selected_books = [band['books'][idx][0] for idx in selected_indices]
        
        recommendations.extend(selected_books)
        remaining_limit -= len(selected_books)
        
        if remaining_limit <= 0:
            break
    
    # If we still need more, add random books from any band
    if remaining_limit > 0:
        logger.info(f"Need {remaining_limit} more books, adding from remaining pool")
        all_available = []
        for band_name in ['high', 'medium_high', 'medium', 'low']:
            all_available.extend(bands[band_name]['books'])
        
        # Get remaining books not already selected
        remaining_books = [book for book, _ in all_available if book not in recommendations]
        
        if remaining_books:
            # Randomly select from remaining books
            additional = random.sample(
                remaining_books, 
                min(remaining_limit, len(remaining_books))
            )
            recommendations.extend(additional)
    
    return recommendations[:limit]


def extract_keywords_from_book(book):
    """
    Extract relevant keywords from book title and metadata
    """
    keywords = set()
    
    # Extract from title
    if book.title:
        # Split title into words and filter common words
        title_words = book.title.lower().split()
        # Remove common stop words
        stop_words = {'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'}
        title_keywords = [word.strip('.,!?;:()[]{}') for word in title_words if word not in stop_words]
        keywords.update(title_keywords)
    
    # Extract from metadata
    if book.metadata_json:
        # Check for subject/topic fields in metadata
        metadata = book.metadata_json
        for field in ['subject', 'topics', 'tags', 'category', 'genre', 'keywords']:
            if field in metadata:
                if isinstance(metadata[field], list):
                    for item in metadata[field]:
                        keywords.add(str(item).lower())
                elif isinstance(metadata[field], str):
                    keywords.add(metadata[field].lower())
    
    return keywords


def calculate_keyword_relevance(book, target_keywords):
    """
    Calculate relevance score between a book and target keywords
    Higher score means more relevant
    
    Score calculation:
    - Exact keyword match: 2 points per match
    - Keyword in title: 1 point per match
    - Keyword in metadata: 0.5 points per match
    """
    if not target_keywords:
        return 0
    
    score = 0
    
    # Get book's keywords
    book_keywords = extract_keywords_from_book(book)
    
    # Count matching keywords (exact matches from extracted keywords)
    matching_keywords = target_keywords.intersection(book_keywords)
    score += len(matching_keywords) * 2  # Weighted higher
    
    # Bonus for keyword appearing in title
    if book.title:
        book_title_lower = book.title.lower()
        for keyword in target_keywords:
            if keyword in book_title_lower:
                score += 1
    
    # Bonus for keyword appearing in metadata
    if book.metadata_json:
        metadata_str = str(book.metadata_json).lower()
        for keyword in target_keywords:
            if keyword in metadata_str:
                score += 0.5
    
    return score


async def get_simple_recommendations(book_id: int, limit: int, db: Session, target_keywords: set = None):
    """
    Fallback function to get simple recommendations based on title similarity
    """
    logger.info(f"Using simple recommendations for book {book_id}")
    
    # Get the book
    book = db.query(models.Book).filter(models.Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    
    # If target_keywords weren't provided, extract them now
    if target_keywords is None:
        target_keywords = extract_keywords_from_book(book)
    
    # Get all books
    all_books = db.query(models.Book).filter(
        models.Book.id != book_id,
        models.Book.content.isnot(None),
        models.Book.content != ""
    ).all()
    
    # Score books based on keyword relevance
    scored_books = []
    for rec in all_books:
        score = calculate_keyword_relevance(rec, target_keywords)
        scored_books.append((rec, score))
    
    # Use stratified recommendations for fallback
    recommendations = await get_stratified_recommendations(
        scored_books, 
        limit, 
        target_keywords, 
        db,
        min_relevance_threshold=0.5  # Lower threshold for fallback
    )
    
    # Format response
    return [
        BookDetailResponse(
            id=rec.id,
            title=rec.title,
            author=rec.author,
            file_path=rec.file_path,
            file_size=rec.file_size,
            date_published=rec.date_published,
            indexed=rec.embedding is not None,
            metadata_json=rec.metadata_json,
            created_at=rec.created_at,
            content_preview=(
                rec.content[:500] + "..."
                if rec.content and len(rec.content) > 500
                else rec.content
            ),
            embedding_status="indexed" if rec.embedding is not None else "pending",
        )
        for rec in recommendations
    ]



@router.get("/stats/summary")
async def get_library_stats(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(oauth2.get_current_user),
):
    """Get statistics about your book library"""
    # All authenticated users can view library stats
    total_books = crud.count_books(db)
    indexed_books = crud.count_indexed_books(db)
    total_size = crud.get_total_size(db)
    top_authors = crud.get_top_authors
    # Get recent books
    recent_books = crud.get_recent_books(db, limit=5)

    return {
        "top_authors": top_authors,
        "total_books": total_books,
        "indexed_books": indexed_books,
        "pending_indexing": total_books - indexed_books,
        "total_size_kb": total_size,
        "recent_books": [{"id": b.id, "title": b.title} for b in recent_books],
    }


@router.delete("/{book_id}")
async def delete_book(
    book_id: int,
    delete_file: bool = True,
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a book from database and optionally from disk (Superuser only)"""
    # Superuser check
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only superusers can delete books",
        )

    book = crud.get_book(db, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    # Delete from disk if requested
    if delete_file and os.path.exists(book.file_path):
        os.remove(book.file_path)

    # Delete from database
    crud.delete_book(db, book_id)

    return {"message": f"Book {book.title} deleted successfully"}


# Background task function
def process_and_index_book(book_id: int, file_path: str, db: Session):
    """Background task to process and index a book"""

    # Create new session for background task
    db = SessionLocal()
    try:
        processor = BookProcessor(db)
        # Create a new event loop for the background task
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        # Run the async function and wait for result
        result = loop.run_until_complete(
            processor.process_single_book(book_id, file_path)
        )

        print(f"Indexing complete for book {book_id}: {result}")
        loop.close()
    except Exception as e:
        print(f"Error indexing book {book_id}: {e}")
        import traceback

        traceback.print_exc()
    finally:
        db.close()


@router.post("/trigger-ml-training", status_code=status.HTTP_202_ACCEPTED)
async def trigger_ml_training_manually(
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db),
):
    """Manually trigger ML model training (superuser only) - DOES NOT AFFECT EXISTING FEATURES"""

    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only superusers can trigger ML training",
        )

    ml_engine = MLEngine(db)

    # Run in background so it doesn't block
    background_tasks.add_task(ml_engine.train_all_models_background)

    return {
        "message": "ML training started in background. This does not affect existing research or search functionality.",
        "status": "Training models will be available when complete",
    }
