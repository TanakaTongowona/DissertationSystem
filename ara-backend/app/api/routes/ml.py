from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional, Dict, Any
from app.schemas.ml import TrainRequest, PredictionResponse, PredictRequest, ModelResponse
from app.database.session import get_db
from app.agents.ml_engine import MLEngine
from app.auth_services import oauth2
from app.database import models
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ml", tags=["machine-learning"])


@router.post("/train", status_code=status.HTTP_202_ACCEPTED)
async def train_models(
    request: TrainRequest,
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db)
):
    """Start background training of ML models (superuser only)"""
    
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only superusers can train ML models"
        )
    
    ml_engine = MLEngine(db)
    
    # Start training in background
    background_tasks.add_task(ml_engine.train_all_models_background)
    
    return {
        "message": "Model training started in background",
        "model_type": request.model_type
    }



@router.post("/predict/{model_id}", response_model=PredictionResponse)
async def predict(
    model_id: int,
    request: PredictRequest,
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db)
):
    """Make a prediction using a trained model (fast, synchronous)"""
    
    ml_engine = MLEngine(db)
    result = ml_engine.predict(model_id, request.features)
    
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    
    return result



@router.get("/models", response_model=List[ModelResponse])
async def list_models(
    skip: int = 0,
    limit: int = 100,
    model_type: Optional[str] = None,
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db)
):
    """List all trained ML models."""

    query = db.query(models.MLModel)
    if model_type:
        query = query.filter(models.MLModel.model_type == model_type)

    all_models = query.order_by(models.MLModel.created_at.desc()).offset(skip).limit(limit).all()

    # Key metrics to surface per model type — one value each
    KEY_METRICS = {
        "classification": "test_accuracy",
        "regression":     "test_r2",
        "clustering":     "silhouette_score",
    }

    result = []
    for model in all_models:
        key_metric_name = KEY_METRICS.get(model.model_type)
        metrics = []
        if key_metric_name:
            m = (
                db.query(models.ModelMetric)
                .filter(
                    models.ModelMetric.model_id == model.id,
                    models.ModelMetric.metric_name == key_metric_name,
                )
                .first()
            )
            if m:
                metrics = [{"name": m.metric_name, "value": m.metric_value}]

        result.append({
            "id": model.id,
            "name": model.name,
            "model_type": model.model_type,
            "algorithm": model.algorithm,
            "version": model.version,
            "status": model.status,
            "created_at": model.created_at.isoformat() if model.created_at else None,
            "metrics": metrics,
        })

    return result



@router.post("/predict-author/{book_id}")
async def predict_author_for_book(
    book_id: int,
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db)
):
    """Predict author for a book using trained model (only if model exists and author missing)"""    
    # Get the book
    book = db.query(models.Book).filter(models.Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    
    # Only predict if author is missing or user explicitly wants prediction
    if book.author and book.author.strip():
        return {
            "book_id": book_id,
            "title": book.title,
            "current_author": book.author,
            "message": "Book already has an author. Use force=True to override."
        }
    
    # Load latest author classifier
    author_model = db.query(models.MLModel).filter(
        models.MLModel.name == "author_classifier",
        models.MLModel.status.in_(["ready", "active"])
    ).order_by(models.MLModel.created_at.desc()).first()
    
    if not author_model:
        raise HTTPException(
            status_code=404, 
            detail="No author classifier model available. Train one first at /ml/train"
        )
    
    ml_engine = MLEngine(db)
    
    # Extract features for this book
    features = await extract_ml_features_for_book(book, db)
    
    # Make prediction
    prediction = ml_engine.predict(author_model.id, features)
    
    return {
        "book_id": book_id,
        "title": book.title,
        "predicted_author": prediction.get('prediction'),
        "confidence": prediction.get('confidence'),
        "message": "This is a prediction. Update the book metadata to save it."
    }



@router.post("/apply-author-prediction/{book_id}")
async def apply_author_prediction(
    book_id: int,
    force: bool = False,
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db)
):
    """Predict and automatically update author if missing (superuser only)"""
    
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only superusers can automatically update book metadata"
        )
    
    # First get prediction
    prediction_result = await predict_author_for_book(book_id, current_user, db)
    
    if "error" in prediction_result:
        raise HTTPException(status_code=400, detail=prediction_result["error"])
    
    book = db.query(models.Book).filter(models.Book.id == book_id).first()
    
    # Update if no author or force=True
    if not book.author or force:
        book.author = prediction_result["predicted_author"]
        db.commit()
        
        return {
            "message": f"Author updated to '{book.author}'",
            "confidence": prediction_result["confidence"]
        }
    else:
        return {
            "message": f"Book already has author '{book.author}'. Use force=True to override."
        }



async def extract_ml_features_for_book(book: models.Book, db: Session) -> Dict[str, Any]:
    """Extract features needed for ML predictions"""
    from app.agents.ml_engine import MLEngine
    
    ml_engine = MLEngine(db)
    features_df = ml_engine.extract_book_features([book])
    
    if features_df.empty:
        return {
            'word_count': 0,
            'avg_word_length': 0,
            'file_size_mb': 0,
            'title_length': len(book.title) if book.title else 0,
            'char_count': 0,
            'has_author': 1 if book.author else 0,
            'author_length': len(book.author) if book.author else 0,
        }
    
    features = features_df.iloc[0].to_dict()
    
    # Add TF-IDF features (simplified - in production you'd compute these)
    # For now, just add zeros for the expected features
    for i in range(200):  # Match your TF-IDF max_features
        features[f'feature_{i}'] = 0
    
    return features



@router.get("/models/{model_id}/performance")
async def get_model_performance(
    model_id: int,
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db)
):
    """Get detailed performance metrics for a model"""
    
    ml_engine = MLEngine(db)
    performance = ml_engine.get_model_performance(model_id)
    
    if "error" in performance:
        raise HTTPException(status_code=404, detail=performance["error"])
    
    return performance



@router.post("/models/{model_id}/retrain")
async def retrain_model(
    model_id: int,
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db)
):
    """Retrain a specific model"""
    
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only superusers can retrain models"
        )
    
    # Get model
    model = db.query(models.MLModel).filter(
        models.MLModel.id == model_id
    ).first()
    
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    
    # Get all books
    books = db.query(models.Book).filter(
        models.Book.content.isnot(None)
    ).all()
    
    if len(books) < 10:
        raise HTTPException(status_code=400, detail="Not enough books for retraining")
    
    ml_engine = MLEngine(db)
    
    # Start retraining in background based on model type
    if model.name == "author_classifier":
        background_tasks.add_task(ml_engine.train_author_classifier, books)
    elif model.name == "book_popularity_regressor":
        background_tasks.add_task(ml_engine.train_book_popularity_regressor, books)
    elif model.name == "book_clustering":
        background_tasks.add_task(ml_engine.train_book_clustering, books, 5)
    else:
        background_tasks.add_task(ml_engine.train_all_models_background)
    
    return {"message": f"Retraining started for model {model.name}"}



@router.post("/models/{model_id}/activate")
async def activate_model(
    model_id: int,
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db)
):
    """Activate a specific model version for production (superuser only)"""
    
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only superusers can activate models"
        )
    
    model = db.query(models.MLModel).filter(
        models.MLModel.id == model_id
    ).first()
    
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    
    # Deactivate other models of same type
    db.query(models.MLModel).filter(
        models.MLModel.name == model.name,
        models.MLModel.status == "active"
    ).update({"status": "ready"})
    
    # Activate this model
    model.status = "active"
    db.commit()
    
    return {
        "message": f"Model {model.name} version {model.version} activated",
        "model_id": model_id
    }



@router.get("/dashboard/stats")
async def get_ml_dashboard_stats(
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db)
):
    """Get ML dashboard statistics (superuser only)"""
    
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only superusers can view ML dashboard"
        )
    
    # Get model counts
    models_count = db.query(models.MLModel).count()
    ready_models = db.query(models.MLModel).filter(
        models.MLModel.status == "ready"
    ).count()
    
    # Get total predictions
    total_predictions = db.query(models.ModelPrediction).count()
    
    # Get average prediction time
    avg_time = db.query(func.avg(models.ModelPrediction.prediction_time_ms)).scalar()
    
    # Get recent predictions by model
    recent_predictions = db.query(
        models.MLModel.name,
        func.count(models.ModelPrediction.id).label('prediction_count')
    ).join(
        models.ModelPrediction,
        models.MLModel.id == models.ModelPrediction.model_id
    ).group_by(
        models.MLModel.name
    ).order_by(
        func.count(models.ModelPrediction.id).desc()
    ).limit(5).all()
    
    # Get model performance summary
    model_performance = []
    for model in db.query(models.MLModel).filter(models.MLModel.status == "ready").all():
        # Get key metrics
        metrics = db.query(models.ModelMetric).filter(
            models.ModelMetric.model_id == model.id
        ).all()
        
        performance = {
            "model_id": model.id,
            "name": model.name,
            "type": model.model_type,
            "version": model.version,
            "created_at": model.created_at
        }
        
        for metric in metrics:
            if metric.metric_name in ['test_accuracy', 'test_r2', 'silhouette_score']:
                performance[metric.metric_name] = metric.metric_value
        
        model_performance.append(performance)
    
    return {
        "models": {
            "total": models_count,
            "ready": ready_models,
            "training": models_count - ready_models
        },
        "predictions": {
            "total": total_predictions,
            "avg_time_ms": float(avg_time) if avg_time else 0
        },
        "recent_models": model_performance[:5],
        "most_used_models": [{"name": name, "predictions": count} for name, count in recent_predictions]
    }