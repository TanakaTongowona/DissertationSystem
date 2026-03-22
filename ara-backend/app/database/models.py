# app/database/models.py
from sqlalchemy import TIMESTAMP, Boolean, Column, ForeignKey, Integer, String, Text, DateTime, JSON, Date, Float
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from pgvector.sqlalchemy import Vector

Base = declarative_base()

class Book(Base):
    __tablename__ = "books"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    author = Column(String, nullable=True)
    file_path = Column(String, unique=True, nullable=False)
    file_size = Column(Integer, nullable=True)
    content = Column(Text, nullable=True)  # Extracted text
    metadata_json = Column(JSON, nullable=True)  # Flexible metadata
    embedding = Column(Vector(384))  # pgvector
    date_published = Column(Date, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    external_source = Column(String, nullable=True)  # "google_books", etc.
    external_id = Column(String, nullable=True)
    isbn = Column(String, nullable=True, index=True)
    isbn13 = Column(String, nullable=True)
    doi = Column(String, nullable=True)
    cover_path = Column(String, nullable=True)
    subjects = Column(JSON, nullable=True)  # Categories/tags
    description = Column(Text, nullable=True)  # Ful
    
    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "author": self.author,
            "file_path": self.file_path,
            "file_size": self.file_size,
            "metadata": self.metadata_json,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }

class ResearchSession(Base):
    __tablename__ = "research_sessions"
    
    id = Column(Integer, primary_key=True, index=True)
    query = Column(Text, nullable=False)
    plan = Column(Text, nullable=True)
    answer = Column(Text, nullable=True)
    sources = Column(JSON, nullable=True)  # Books used
    provider_used = Column(JSON, nullable=True)  # Which LLM provider at each step
    confidence = Column(Float, nullable=True)
    source_type = Column(String, nullable=True)
    research_method = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)
    owner_id = Column(Integer, ForeignKey("users.id"))
    filter_info = Column(JSON, nullable=True)  # Store date filter information
    owner = relationship("User", back_populates="research_sessions")

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    first_name = Column(String, nullable=False)
    last_name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False)
    password = Column(String, nullable=False)
    created_at = Column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )
    research_sessions = relationship("ResearchSession", back_populates="owner", foreign_keys=[ResearchSession.owner_id])
    is_superuser = Column(Boolean, nullable=False, server_default="false")
    is_active = Column(Boolean, nullable=False, server_default="false")


# app/database/models.py - Add these models

class MLModel(Base):
    """Store trained ML models and their metadata"""
    __tablename__ = "ml_models"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)  # e.g., "author_classifier", "book_popularity_regressor"
    model_type = Column(String, nullable=False)  # "classification", "regression", "clustering"
    algorithm = Column(String, nullable=False)  # "random_forest", "svm", "kmeans", etc.
    version = Column(String, nullable=False)  # "v1.0.0", timestamp-based
    file_path = Column(String, nullable=True)  # Path to serialized model
    feature_names = Column(JSON, nullable=True)  # List of feature names
    target_column = Column(String, nullable=True)  # What we're predicting
    status = Column(String, default="training")  # "training", "ready", "failed"
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationships
    metrics = relationship("ModelMetric", back_populates="model")
    predictions = relationship("ModelPrediction", back_populates="model")
    training_data = relationship("TrainingData", back_populates="model")

class ModelMetric(Base):
    """Store model performance metrics"""
    __tablename__ = "model_metrics"
    
    id = Column(Integer, primary_key=True, index=True)
    model_id = Column(Integer, ForeignKey("ml_models.id"))
    metric_name = Column(String, nullable=False)  # "accuracy", "f1", "mse", "silhouette", etc.
    metric_value = Column(Float, nullable=False)
    training_duration_seconds = Column(Float, nullable=True)
    cv_fold = Column(Integer, nullable=True)  # Which cross-validation fold (null for overall)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    model = relationship("MLModel", back_populates="metrics")

class ModelPrediction(Base):
    """Store predictions made by models"""
    __tablename__ = "model_predictions"
    
    id = Column(Integer, primary_key=True, index=True)
    model_id = Column(Integer, ForeignKey("ml_models.id"))
    book_id = Column(Integer, ForeignKey("books.id"), nullable=True)
    session_id = Column(Integer, ForeignKey("research_sessions.id"), nullable=True)
    prediction = Column(JSON, nullable=False)  # The prediction result
    confidence = Column(Float, nullable=True)  # Confidence score for classification
    features_used = Column(JSON, nullable=True)  # Snapshot of features used
    prediction_time_ms = Column(Float, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    model = relationship("MLModel", back_populates="predictions")
    book = relationship("Book")
    session = relationship("ResearchSession")

class TrainingData(Base):
    """Track datasets used for training"""
    __tablename__ = "training_data"
    
    id = Column(Integer, primary_key=True, index=True)
    model_id = Column(Integer, ForeignKey("ml_models.id"))
    data_type = Column(String, nullable=False)  # "training", "validation", "test"
    book_ids = Column(JSON, nullable=True)  # List of book IDs used
    sample_size = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    model = relationship("MLModel", back_populates="training_data")