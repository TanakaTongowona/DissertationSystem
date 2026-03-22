from pydantic import BaseModel
from typing import List, Optional, Any

# Pydantic models
class TrainRequest(BaseModel):
    model_type: Optional[str] = "all"  # "classifier", "regressor", "clustering", "all"
    n_clusters: Optional[int] = None

class PredictRequest(BaseModel):
    features: dict

class ModelResponse(BaseModel):
    id: int
    name: str
    model_type: str
    algorithm: str
    version: str
    status: str
    created_at: str
    metrics: Optional[List[dict]] = None

# class PredictionResponse(BaseModel):
#     prediction: Any
#     confidence: Optional[float]
#     prediction_time_ms: float
#     model_id: int

class PredictionResponse(BaseModel):
    prediction: Any
    confidence: Optional[float] = None
    probabilities: Optional[List[float]] = None
    prediction_time_ms: float
    model_id: int

class ModelMetric(BaseModel):
    name: str
    value: float

class RecommendationRequest(BaseModel):
    book_id: int
    limit: int = 5
    use_clustering: bool = True
    use_popularity: bool = True

class RecommendationResponse(BaseModel):
    book_id: int
    title: str
    author: Optional[str]
    similarity_score: Optional[float]
    popularity_score: Optional[float]