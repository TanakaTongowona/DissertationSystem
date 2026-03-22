# app/agents/ml_engine.py
import numpy as np
import pandas as pd
import joblib
from typing import List, Dict, Any, Tuple, Optional
from sqlalchemy.orm import Session
from sklearn.model_selection import cross_val_score, KFold, StratifiedKFold, train_test_split
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.cluster import KMeans
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score,
    mean_squared_error, r2_score, silhouette_score,
)
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import StandardScaler, LabelEncoder
from datetime import datetime
from pathlib import Path
import logging
from concurrent.futures import ThreadPoolExecutor
import threading
from sqlalchemy import func
from app.database import models
from app.config import get_settings

logger = logging.getLogger(__name__)

class MLEngine:
    """
    ML Engine that runs in background without affecting response times
    """
    
    def __init__(self, db: Session):
        self.db = db
        self.settings = get_settings()
        self.models_dir = Path("./ml_models")
        self.models_dir.mkdir(exist_ok=True)
        
        # Thread pool for background processing
        self.executor = ThreadPoolExecutor(max_workers=2)
        
        # Cache for loaded models
        self.model_cache = {}
        self.cache_lock = threading.Lock()
    
    # ==================== FEATURE ENGINEERING ====================
    
    def extract_book_features(self, books: List[models.Book]) -> pd.DataFrame:
        """
        Extract features from books for ML models
        Runs synchronously but should be called in background
        """
        features = []
        
        for book in books:
            if not book.content:
                continue
                
            book_features = {
                'book_id': book.id,
                'title_length': len(book.title) if book.title else 0,
                'word_count': len(book.content.split()) if book.content else 0,
                'char_count': len(book.content) if book.content else 0,
                'avg_word_length': np.mean([len(w) for w in book.content.split()]) if book.content else 0,
                'file_size_mb': (book.file_size or 0) / (1024 * 1024),
                'has_author': 1 if book.author else 0,
                'author_length': len(book.author) if book.author else 0,
            }
            
            # Text-based features using TF-IDF (will be handled separately)
            # Add metadata features if available
            if book.metadata_json:
                meta = book.metadata_json
                book_features.update({
                    'page_count': meta.get('page_count', 0),
                    'has_toc': 1 if meta.get('table_of_contents') else 0,
                    'has_images': 1 if meta.get('has_images') else 0,
                })
            
            features.append(book_features)
        
        return pd.DataFrame(features)
    
    def create_text_features(self, books: List[models.Book], max_features: int = 100) -> Tuple[np.ndarray, List[str]]:
        """Create TF-IDF features from book content"""
        if not books:
            return np.array([]), []
        
        # Extract content
        contents = [book.content or "" for book in books]
        book_ids = [book.id for book in books]
        
        # Create TF-IDF features
        vectorizer = TfidfVectorizer(
            max_features=max_features,
            stop_words='english',
            ngram_range=(1, 2)
        )
        
        tfidf_matrix = vectorizer.fit_transform(contents)
        feature_names = vectorizer.get_feature_names_out()
        
        return tfidf_matrix.toarray(), feature_names, book_ids
    
    # ==================== CLASSIFICATION MODELS ====================
    
    def train_author_classifier(self, books: List[models.Book]) -> Dict[str, Any]:
        """
        Train a classifier to predict author based on book content
        Example of supervised classification
        """
        logger.info("Training author classifier...")
        
        # Filter books with authors
        books_with_authors = [b for b in books if b.author and b.content]
        if len(books_with_authors) < 10:
            return {"error": "Not enough books with authors for training"}
        
        # Extract features
        df_features = self.extract_book_features(books_with_authors)
        tfidf_features, feature_names, _ = self.create_text_features(books_with_authors, max_features=200)
        
        if tfidf_features.shape[0] == 0:
            return {"error": "Could not extract text features"}
        
        # Combine features
        numerical_features = df_features[['word_count', 'avg_word_length', 'file_size_mb']].values
        X = np.hstack([numerical_features, tfidf_features])
        
        # Encode authors
        authors = [b.author for b in books_with_authors]
        label_encoder = LabelEncoder()
        y = label_encoder.fit_transform(authors)
        
        # Train-test split
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )
        
        # Train Random Forest Classifier
        model = RandomForestClassifier(
            n_estimators=100,
            max_depth=10,
            random_state=42,
            n_jobs=-1
        )
        
        # Cross-validation
        cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
        cv_scores = cross_val_score(model, X_train, y_train, cv=cv, scoring='accuracy')
        
        # Train on full training set
        model.fit(X_train, y_train)
        
        # Evaluate on test set
        y_pred = model.predict(X_test)
        
        metrics = {
            'cv_mean_accuracy': float(np.mean(cv_scores)),
            'cv_std_accuracy': float(np.std(cv_scores)),
            'test_accuracy': float(accuracy_score(y_test, y_pred)),
            'test_precision_macro': float(precision_score(y_test, y_pred, average='macro', zero_division=0)),
            'test_recall_macro': float(recall_score(y_test, y_pred, average='macro', zero_division=0)),
            'test_f1_macro': float(f1_score(y_test, y_pred, average='macro', zero_division=0)),
        }
        
        # Per-fold metrics
        cv_fold_metrics = []
        for i, score in enumerate(cv_scores):
            cv_fold_metrics.append({
                'fold': i,
                'accuracy': float(score)
            })
        
        # Save model
        model_id = self._save_model(
            model=model,
            name="author_classifier",
            algorithm="random_forest",
            model_type="classification",
            feature_names=['word_count', 'avg_word_length', 'file_size_mb'] + list(feature_names),
            target_column="author",
            label_encoder=label_encoder,
            metrics=metrics,
            cv_fold_metrics=cv_fold_metrics
        )
        
        return {
            "model_id": model_id,
            "metrics": metrics,
            "cv_metrics": cv_fold_metrics,
            "n_classes": len(np.unique(y)),
            "training_samples": len(X_train),
            "test_samples": len(X_test)
        }
    
    # ==================== REGRESSION MODELS ====================
    
    def train_book_popularity_regressor(self, books: List[models.Book]) -> Dict[str, Any]:
        """
        Train a regressor to predict book popularity based on features
        This is a proxy - you'd need actual popularity data
        Example of supervised regression
        """
        logger.info("Training book popularity regressor...")
        
        # For demo, create synthetic popularity score based on content features
        books_with_content = [b for b in books if b.content]
        if len(books_with_content) < 20:
            return {"error": "Not enough books for training"}
        
        # Extract features
        df_features = self.extract_book_features(books_with_content)
        tfidf_features, feature_names, _ = self.create_text_features(books_with_content, max_features=100)
        
        if tfidf_features.shape[0] == 0:
            return {"error": "Could not extract text features"}
        
        # Create synthetic target (popularity score)
        # In real app, this would come from user interactions, downloads, etc.
        np.random.seed(42)
        popularity = (
            df_features['word_count'].values / 10000 +
            df_features['avg_word_length'].values * 0.1 +
            np.random.normal(0, 0.1, len(df_features))
        )
        popularity = np.clip(popularity, 0, 1)  # Normalize to 0-1
        
        # Combine features
        numerical_features = df_features[['word_count', 'avg_word_length', 'file_size_mb']].values
        X = np.hstack([numerical_features, tfidf_features])
        y = popularity
        
        # Train-test split
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42
        )
        
        # Scale features
        scaler = StandardScaler()
        X_train_scaled = scaler.fit_transform(X_train)
        X_test_scaled = scaler.transform(X_test)
        
        # Train Random Forest Regressor
        model = RandomForestRegressor(
            n_estimators=100,
            max_depth=10,
            random_state=42,
            n_jobs=-1
        )
        
        # Cross-validation
        cv = KFold(n_splits=5, shuffle=True, random_state=42)
        cv_scores = cross_val_score(model, X_train_scaled, y_train, cv=cv, scoring='r2')
        cv_mse = -cross_val_score(model, X_train_scaled, y_train, cv=cv, scoring='neg_mean_squared_error')
        
        # Train on full training set
        model.fit(X_train_scaled, y_train)
        
        # Evaluate on test set
        y_pred = model.predict(X_test_scaled)
        
        metrics = {
            'cv_mean_r2': float(np.mean(cv_scores)),
            'cv_std_r2': float(np.std(cv_scores)),
            'cv_mean_mse': float(np.mean(cv_mse)),
            'test_r2': float(r2_score(y_test, y_pred)),
            'test_mse': float(mean_squared_error(y_test, y_pred)),
            'test_rmse': float(np.sqrt(mean_squared_error(y_test, y_pred))),
        }
        
        # Per-fold metrics
        cv_fold_metrics = []
        for i, (r2, mse) in enumerate(zip(cv_scores, cv_mse)):
            cv_fold_metrics.append({
                'fold': i,
                'r2': float(r2),
                'mse': float(mse)
            })
        
        # Save model
        model_id = self._save_model(
            model=model,
            name="book_popularity_regressor",
            algorithm="random_forest",
            model_type="regression",
            feature_names=['word_count', 'avg_word_length', 'file_size_mb'] + list(feature_names),
            target_column="popularity_score",
            scaler=scaler,
            metrics=metrics,
            cv_fold_metrics=cv_fold_metrics
        )
        
        return {
            "model_id": model_id,
            "metrics": metrics,
            "cv_metrics": cv_fold_metrics,
            "training_samples": len(X_train),
            "test_samples": len(X_test)
        }
    
    # ==================== CLUSTERING MODELS (UNSUPERVISED) ====================
    
    def train_book_clustering(self, books: List[models.Book], n_clusters: int = None) -> Dict[str, Any]:
        """
        Cluster books by content similarity
        If n_clusters is None, automatically determine optimal clusters based on silhouette score
        """
        logger.info("Training book clustering...")
        
        books_with_content = [b for b in books if b.content and b.content.strip()]
        min_books_required = 10  # Minimum threshold for meaningful clustering
        
        if len(books_with_content) < min_books_required:
            return {"error": f"Not enough books with content for clustering. Found: {len(books_with_content)}, need: {min_books_required}"}
        
        # Extract features
        df_features = self.extract_book_features(books_with_content)
        tfidf_features, feature_names, _ = self.create_text_features(books_with_content, max_features=200)
        
        if tfidf_features.shape[0] == 0:
            return {"error": "Could not extract text features"}
        
        # Combine features
        numerical_features = df_features[['word_count', 'avg_word_length', 'file_size_mb']].values
        X = np.hstack([numerical_features, tfidf_features])
        
        # Scale features
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)
        
        # Determine max clusters to try (cannot exceed half the number of books)
        max_clusters = min(10, len(books_with_content) // 3)
        if max_clusters < 2:
            return {"error": f"Not enough books for clustering. Need at least 6 books, have {len(books_with_content)}"}
        
        # Try different cluster counts for internal evaluation
        silhouette_scores = []
        
        for k in range(2, max_clusters + 1):
            kmeans = KMeans(n_clusters=k, random_state=42, n_init=10)
            labels = kmeans.fit_predict(X_scaled)
            
            # Check if we got valid clusters (all clusters have at least 2 members for meaningful silhouette)
            unique_labels, counts = np.unique(labels, return_counts=True)
            if len(unique_labels) == k and np.min(counts) >= 2:
                score = silhouette_score(X_scaled, labels)
                silhouette_scores.append({'n_clusters': k, 'silhouette': float(score)})
                logger.info(f"k={k}, silhouette={score:.4f}, cluster sizes={counts}")
            else:
                logger.warning(f"Skipping k={k}: clusters have insufficient members. Sizes: {dict(zip(unique_labels, counts))}")
        
        if not silhouette_scores:
            return {"error": "Could not compute silhouette scores for any cluster configuration"}
        
        # Determine optimal clusters
        if n_clusters is None:
            # Auto-select: find the k with highest silhouette score
            best_silhouette = max(silhouette_scores, key=lambda x: x['silhouette'])
            optimal_clusters = best_silhouette['n_clusters']
            logger.info(f"Auto-selected optimal clusters: {optimal_clusters} (silhouette: {best_silhouette['silhouette']:.3f})")
        else:
            # User-specified clusters
            optimal_clusters = n_clusters
            # Check if requested clusters is reasonable
            if optimal_clusters > max_clusters:
                logger.warning(f"Requested {optimal_clusters} clusters but only have {len(books_with_content)} books. Using {max_clusters} instead.")
                optimal_clusters = max_clusters
            elif optimal_clusters < 2:
                optimal_clusters = 2
            
            # Log comparison with auto-selection
            best_auto = max(silhouette_scores, key=lambda x: x['silhouette'])
            if best_auto['n_clusters'] != optimal_clusters:
                logger.warning(f"Using user-specified {optimal_clusters} clusters, but auto-selection suggests {best_auto['n_clusters']} clusters with better silhouette score ({best_auto['silhouette']:.3f} vs {next((s['silhouette'] for s in silhouette_scores if s['n_clusters'] == optimal_clusters), 0):.3f})")
        
        # Train final model with optimal clusters
        model = KMeans(n_clusters=optimal_clusters, random_state=42, n_init=10)
        cluster_labels = model.fit_predict(X_scaled)
        
        # Calculate cluster statistics
        cluster_stats = []
        for i in range(optimal_clusters):
            cluster_books = [books_with_content[j] for j, label in enumerate(cluster_labels) if label == i]
            if cluster_books:  # Only add non-empty clusters
                cluster_stats.append({
                    'cluster_id': i,
                    'size': len(cluster_books),
                    'percentage': len(cluster_books) / len(books_with_content) * 100,
                    'sample_titles': [b.title for b in cluster_books[:3]]
                })
        
        # Calculate final silhouette score for the optimal configuration
        final_silhouette = silhouette_score(X_scaled, cluster_labels) if len(set(cluster_labels)) > 1 else -1
        
        metrics = {
            'inertia': float(model.inertia_),
            'n_clusters': optimal_clusters,
            'silhouette_optimal': silhouette_scores,
            'silhouette_score': float(final_silhouette),
            'auto_selected': n_clusters is None,
            'total_books': len(books_with_content),
            'max_clusters_tested': max_clusters
        }
        
        # Log summary
        logger.info(f"Clustering completed: {optimal_clusters} clusters, silhouette={final_silhouette:.4f}")
        
        # Save model
        model_id = self._save_model(
            model=model,
            name="book_clustering",
            algorithm="kmeans",
            model_type="clustering",
            feature_names=['word_count', 'avg_word_length', 'file_size_mb'] + list(feature_names),
            target_column=None,
            scaler=scaler,
            metrics=metrics,
            cluster_stats=cluster_stats
        )
        
        return {
            "model_id": model_id,
            "metrics": metrics,
            "cluster_stats": cluster_stats,
            "total_books_clustered": len(books_with_content)
        }
    
    # ==================== MODEL PERSISTENCE ====================
    
    def _save_model(self, model, name: str, algorithm: str, model_type: str,
                   feature_names: List[str], target_column: Optional[str],
                   metrics: Dict, cv_fold_metrics: Optional[List] = None,
                   **kwargs) -> int:
        """Save model to disk and database"""
        
        # Generate version from timestamp
        version = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # Save model to disk
        model_filename = f"{name}_{version}.joblib"
        model_path = self.models_dir / model_filename
        joblib.dump({
            'model': model,
            'feature_names': feature_names,
            'target_column': target_column,
            **kwargs
        }, model_path)
        
        # Create database record
        db_model = models.MLModel(
            name=name,
            model_type=model_type,
            algorithm=algorithm,
            version=version,
            file_path=str(model_path),
            feature_names=feature_names,
            target_column=target_column,
            status="ready"
        )
        
        self.db.add(db_model)
        self.db.flush()  # Get ID without committing yet
        
        # Save metrics
        for metric_name, metric_value in metrics.items():
            if isinstance(metric_value, (int, float)):
                metric = models.ModelMetric(
                    model_id=db_model.id,
                    metric_name=metric_name,
                    metric_value=float(metric_value)
                )
                self.db.add(metric)
        
        # Save cross-validation fold metrics
        if cv_fold_metrics:
            for fold_metric in cv_fold_metrics:
                for m_name, m_value in fold_metric.items():
                    if m_name != 'fold' and isinstance(m_value, (int, float)):
                        metric = models.ModelMetric(
                            model_id=db_model.id,
                            metric_name=f"{m_name}_fold_{fold_metric['fold']}",
                            metric_value=float(m_value),
                            cv_fold=fold_metric['fold']
                        )
                        self.db.add(metric)
        
        self.db.commit()
        self.db.refresh(db_model)
        
        # Add to cache
        with self.cache_lock:
            self.model_cache[db_model.id] = {
                'model': model,
                'metadata': kwargs
            }
        
        return db_model.id
    
    def load_model(self, model_id: int) -> Optional[Dict]:
        """Load model from cache or disk"""
        # Check cache first
        with self.cache_lock:
            if model_id in self.model_cache:
                return self.model_cache[model_id]
        
        # Load from database
        db_model = self.db.query(models.MLModel).filter(
            models.MLModel.id == model_id,
            models.MLModel.status == "active"
        ).first()
        
        if not db_model or not db_model.file_path:
            return None
        
        try:
            # Load from disk
            model_data = joblib.load(db_model.file_path)
            
            # Add to cache
            with self.cache_lock:
                self.model_cache[model_id] = model_data
            
            return model_data
        except Exception as e:
            logger.error(f"Failed to load model {model_id}: {e}")
            return None
    
    # ==================== PREDICTION (SYNCHRONOUS, FAST) ====================
    
    def predict(self, model_id: int, features: Dict[str, Any]) -> Dict[str, Any]:
        """
        Make predictions with loaded model
        This runs synchronously but is designed to be fast
        """
        import time
        start_time = time.time()
        
        # Load model
        model_data = self.load_model(model_id)
        if not model_data:
            return {"error": "Model not found"}
        
        model = model_data['model']
        feature_names = model_data.get('feature_names', [])
        
        # Prepare features in correct order
        feature_vector = []
        for fname in feature_names:
            feature_vector.append(features.get(fname, 0))
        
        X = np.array([feature_vector])
        
        # Scale if needed
        if 'scaler' in model_data:
            X = model_data['scaler'].transform(X)
        
        # Make prediction
        if hasattr(model, 'predict_proba'):
            # Classification with probabilities
            pred_class = model.predict(X)[0]
            probabilities = model.predict_proba(X)[0]
            confidence = float(np.max(probabilities))
            
            # Get class labels if available
            if 'label_encoder' in model_data:
                pred_class = model_data['label_encoder'].inverse_transform([pred_class])[0]
            
            result = {
                'prediction': str(pred_class),
                'confidence': confidence,
                'probabilities': probabilities.tolist() if hasattr(probabilities, 'tolist') else probabilities
            }
        elif hasattr(model, 'predict'):
            # Regression or clustering
            pred = model.predict(X)[0]
            result = {
                'prediction': float(pred) if isinstance(pred, (np.floating, float)) else int(pred)
            }
        else:
            result = {"error": "Model doesn't support prediction"}
        
        prediction_time = (time.time() - start_time) * 1000  # ms
        
        # Store prediction in database (async to not block)
        self._store_prediction_async(model_id, features, result, prediction_time)
        
        return {
            **result,
            'prediction_time_ms': prediction_time,
            'model_id': model_id
        }
    
    def _store_prediction_async(self, model_id: int, features: Dict, 
                               prediction: Dict, time_ms: float):
        """Store prediction in background thread"""
        def _store():
            db_session = None
            try:
                from app.database.session import SessionLocal
                db_session = SessionLocal()
                
                pred_record = models.ModelPrediction(
                    model_id=model_id,
                    prediction=prediction,
                    features_used=features,
                    prediction_time_ms=time_ms
                )
                db_session.add(pred_record)
                db_session.commit()
            except Exception as e:
                logger.error(f"Failed to store prediction: {e}")
            finally:
                if db_session:
                    db_session.close()
        
        self.executor.submit(_store)
    
    # ==================== BACKGROUND TRAINING ====================
    
    def train_all_models_background(self, clustering_clusters: int = None):
        """
        Train all models in background thread
        
        Args:
            clustering_clusters: Optional number of clusters to use. If None, auto-select optimal.
        """
        def _train():
            logger.info("Starting background model training...")
            
            # Get all books
            books = self.db.query(models.Book).filter(
                models.Book.content.isnot(None)
            ).all()
            
            if len(books) < 10:
                logger.warning("Not enough books for training")
                return
            
            # Train author classifier
            try:
                if len([b for b in books if b.author]) >= 10:
                    result = self.train_author_classifier(books)
                    logger.info(f"Author classifier trained: {result.get('metrics', {})}")
            except Exception as e:
                logger.error(f"Author classifier failed: {e}")
            
            # Train popularity regressor
            try:
                if len(books) >= 20:
                    result = self.train_book_popularity_regressor(books)
                    logger.info(f"Popularity regressor trained: {result.get('metrics', {})}")
            except Exception as e:
                logger.error(f"Popularity regressor failed: {e}")
            
            # Train clustering
            try:
                if len(books) >= 10:
                    # Use auto-selection if no specific clusters requested
                    result = self.train_book_clustering(books, n_clusters=clustering_clusters)
                    logger.info(f"Clustering trained: {result.get('metrics', {})}")
            except Exception as e:
                logger.error(f"Clustering failed: {e}")
            
            logger.info("Background model training complete")
        
        self.executor.submit(_train)
    
    # ==================== MODEL ANALYSIS ====================
    
    def get_model_performance(self, model_id: int) -> Dict[str, Any]:
        """Get comprehensive model performance metrics"""
        model = self.db.query(models.MLModel).filter(
            models.MLModel.id == model_id
        ).first()
        
        if not model:
            return {"error": "Model not found"}
        
        # Get all metrics
        metrics = self.db.query(models.ModelMetric).filter(
            models.ModelMetric.model_id == model_id
        ).all()
        
        # Get prediction stats
        prediction_stats = self.db.query(
            func.count(models.ModelPrediction.id).label('total_predictions'),
            func.avg(models.ModelPrediction.prediction_time_ms).label('avg_prediction_time')
        ).filter(
            models.ModelPrediction.model_id == model_id
        ).first()
        
        # Get training data info
        training_data = self.db.query(models.TrainingData).filter(
            models.TrainingData.model_id == model_id
        ).all()
        
        return {
            "model": {
                "id": model.id,
                "name": model.name,
                "type": model.model_type,
                "algorithm": model.algorithm,
                "version": model.version,
                "created_at": model.created_at.isoformat() if model.created_at else None,
                "status": model.status
            },
            "metrics": [
                {"name": m.metric_name, "value": m.metric_value, "fold": m.cv_fold}
                for m in metrics
            ],
            "prediction_stats": {
                "total_predictions": prediction_stats.total_predictions if prediction_stats else 0,
                "avg_prediction_time_ms": float(prediction_stats.avg_prediction_time) if prediction_stats and prediction_stats.avg_prediction_time else 0
            },
            "training_data": [
                {
                    "type": td.data_type,
                    "sample_size": td.sample_size,
                    "created_at": td.created_at.isoformat() if td.created_at else None
                }
                for td in training_data
            ]
        }