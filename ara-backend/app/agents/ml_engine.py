# app/agents/ml_engine.py
import numpy as np
import pandas as pd
import joblib
from typing import List, Dict, Any, Tuple, Optional
from sqlalchemy.orm import Session
from sklearn.model_selection import ShuffleSplit, train_test_split
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor, GradientBoostingRegressor
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

try:
    from xgboost import XGBRegressor
    XGBOOST_AVAILABLE = True
except ImportError:
    XGBOOST_AVAILABLE = False

logger = logging.getLogger(__name__)


class MLEngine:
    """
    ML Engine that runs in background without affecting response times.
    Popularity regressor uses 3-fold ShuffleSplit CV to compare
    RandomForest, GradientBoosting, and XGBoost; best R² wins.
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
        Extract features from books for ML models.
        Runs synchronously but should be called in background.
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

            if book.metadata_json:
                meta = book.metadata_json
                book_features.update({
                    'page_count': meta.get('page_count', 0),
                    'has_toc': 1 if meta.get('table_of_contents') else 0,
                    'has_images': 1 if meta.get('has_images') else 0,
                })

            features.append(book_features)

        return pd.DataFrame(features)

    def create_text_features(
        self, books: List[models.Book], max_features: int = 100
    ) -> Tuple[np.ndarray, List[str], List[int]]:
        """Create TF-IDF features from book content."""
        if not books:
            return np.array([]), [], []

        contents = [book.content or "" for book in books]
        book_ids = [book.id for book in books]

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
        Train a Random Forest classifier to predict author from book content.
        Uses StratifiedKFold cross-validation.
        """
        from sklearn.model_selection import cross_val_score, StratifiedKFold

        logger.info("Training author classifier...")

        books_with_authors = [b for b in books if b.author and b.content]
        if len(books_with_authors) < 10:
            return {"error": "Not enough books with authors for training"}

        df_features = self.extract_book_features(books_with_authors)
        tfidf_features, feature_names, _ = self.create_text_features(
            books_with_authors, max_features=200
        )

        if tfidf_features.shape[0] == 0:
            return {"error": "Could not extract text features"}

        numerical_features = df_features[['word_count', 'avg_word_length', 'file_size_mb']].values
        X = np.hstack([numerical_features, tfidf_features])

        authors = [b.author for b in books_with_authors]
        label_encoder = LabelEncoder()
        y = label_encoder.fit_transform(authors)

        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )

        model = RandomForestClassifier(
            n_estimators=100,
            max_depth=10,
            random_state=42,
            n_jobs=-1
        )

        cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
        cv_scores = cross_val_score(model, X_train, y_train, cv=cv, scoring='accuracy')

        model.fit(X_train, y_train)
        y_pred = model.predict(X_test)

        metrics = {
            'cv_mean_accuracy': float(np.mean(cv_scores)),
            'cv_std_accuracy': float(np.std(cv_scores)),
            'test_accuracy': float(accuracy_score(y_test, y_pred)),
            'test_precision_macro': float(precision_score(y_test, y_pred, average='macro', zero_division=0)),
            'test_recall_macro': float(recall_score(y_test, y_pred, average='macro', zero_division=0)),
            'test_f1_macro': float(f1_score(y_test, y_pred, average='macro', zero_division=0)),
        }

        cv_fold_metrics = [{'fold': i, 'accuracy': float(s)} for i, s in enumerate(cv_scores)]

        logger.info(
            f"[AUTHOR CLASSIFIER] CV accuracy={metrics['cv_mean_accuracy']:.4f} ± "
            f"{metrics['cv_std_accuracy']:.4f} | test accuracy={metrics['test_accuracy']:.4f}"
        )

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
        Train a popularity regressor.

        Compares RandomForest, GradientBoosting, and XGBoost (when available)
        using 3-fold ShuffleSplit cross-validation. Best model is selected by
        mean R² score across folds, then retrained on the full training split
        and evaluated on a held-out 20% test set.
        """
        logger.info(
            "Training book popularity regressor — comparing RandomForest, "
            "GradientBoosting%s via 3-fold ShuffleSplit CV...",
            ", XGBoost" if XGBOOST_AVAILABLE else " (XGBoost not installed)"
        )

        books_with_content = [b for b in books if b.content]
        if len(books_with_content) < 20:
            return {"error": "Not enough books for training"}

        # ── Feature extraction ────────────────────────────────────────────────
        df_features = self.extract_book_features(books_with_content)
        tfidf_features, feature_names, _ = self.create_text_features(
            books_with_content, max_features=100
        )

        if tfidf_features.shape[0] == 0:
            return {"error": "Could not extract text features"}

        # Synthetic popularity target (replace with real interaction data)
        np.random.seed(42)
        popularity = (
            df_features['word_count'].values / 10000 +
            df_features['avg_word_length'].values * 0.1 +
            np.random.normal(0, 0.1, len(df_features))
        )
        popularity = np.clip(popularity, 0, 1)

        numerical_features = df_features[['word_count', 'avg_word_length', 'file_size_mb']].values
        X = np.hstack([numerical_features, tfidf_features])
        y = popularity

        # ── Scale + train/test split ──────────────────────────────────────────
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        X_train, X_test, y_train, y_test = train_test_split(
            X_scaled, y, test_size=0.2, random_state=42
        )

        # ── Candidate models ──────────────────────────────────────────────────
        candidates: Dict[str, Any] = {
            "random_forest": RandomForestRegressor(
                n_estimators=100, max_depth=10, random_state=42, n_jobs=-1
            ),
            "gradient_boosting": GradientBoostingRegressor(
                n_estimators=100, max_depth=5, learning_rate=0.1, random_state=42
            ),
        }

        if XGBOOST_AVAILABLE:
            candidates["xgboost"] = XGBRegressor(
                n_estimators=100,
                max_depth=5,
                learning_rate=0.1,
                random_state=42,
                n_jobs=-1,
                verbosity=0,
            )
        else:
            logger.warning(
                "XGBoost is not installed. Install with `pip install xgboost` to include it."
            )

        # ── 3-fold ShuffleSplit cross-validation ──────────────────────────────
        ss = ShuffleSplit(n_splits=3, test_size=0.2, random_state=42)
        cv_results: Dict[str, Dict] = {}

        for name, candidate in candidates.items():
            fold_r2_scores: List[float] = []
            fold_mse_scores: List[float] = []

            logger.info("[CV START] %s — running 3 folds...", name)

            for fold_idx, (tr_idx, val_idx) in enumerate(ss.split(X_train)):
                X_fold_tr,  X_fold_val  = X_train[tr_idx],  X_train[val_idx]
                y_fold_tr,  y_fold_val  = y_train[tr_idx],  y_train[val_idx]

                candidate.fit(X_fold_tr, y_fold_tr)
                y_fold_pred = candidate.predict(X_fold_val)

                fold_r2  = float(r2_score(y_fold_val, y_fold_pred))
                fold_mse = float(mean_squared_error(y_fold_val, y_fold_pred))
                fold_r2_scores.append(fold_r2)
                fold_mse_scores.append(fold_mse)

                logger.info(
                    "[CV]  %-20s | fold %d | R²=%7.4f | MSE=%.6f",
                    name, fold_idx, fold_r2, fold_mse
                )

            mean_r2  = float(np.mean(fold_r2_scores))
            std_r2   = float(np.std(fold_r2_scores))
            mean_mse = float(np.mean(fold_mse_scores))

            cv_results[name] = {
                "fold_r2":  fold_r2_scores,
                "fold_mse": fold_mse_scores,
                "mean_r2":  mean_r2,
                "std_r2":   std_r2,
                "mean_mse": mean_mse,
            }

            logger.info(
                "[CV SUMMARY]  %-20s | mean R²=%7.4f ± %.4f | mean MSE=%.6f",
                name, mean_r2, std_r2, mean_mse
            )

        # ── Model selection ───────────────────────────────────────────────────
        best_name = max(cv_results, key=lambda n: cv_results[n]["mean_r2"])
        runner_up_info = " | ".join(
            f"{n}: R²={cv_results[n]['mean_r2']:.4f}"
            for n in cv_results if n != best_name
        )
        logger.info(
            "[MODEL SELECTION] Winner: %s (R²=%.4f) — others: [%s]",
            best_name, cv_results[best_name]["mean_r2"], runner_up_info
        )

        # ── Retrain winner on full train split, evaluate on held-out test ─────
        best_model = candidates[best_name]
        best_model.fit(X_train, y_train)
        y_pred = best_model.predict(X_test)

        test_r2   = float(r2_score(y_test, y_pred))
        test_mse  = float(mean_squared_error(y_test, y_pred))
        test_rmse = float(np.sqrt(test_mse))

        logger.info(
            "[TEST] %s | R²=%.4f | MSE=%.6f | RMSE=%.6f",
            best_name, test_r2, test_mse, test_rmse
        )

        # ── Build flat metrics dict for DB ────────────────────────────────────
        metrics: Dict[str, float] = {}
        for name, res in cv_results.items():
            metrics[f"cv_{name}_mean_r2"]  = res["mean_r2"]
            metrics[f"cv_{name}_std_r2"]   = res["std_r2"]
            metrics[f"cv_{name}_mean_mse"] = res["mean_mse"]
        metrics["test_r2"]   = test_r2
        metrics["test_mse"]  = test_mse
        metrics["test_rmse"] = test_rmse

        # Fold metrics for the winning model only
        cv_fold_metrics = [
            {"fold": i, "r2": r2, "mse": mse}
            for i, (r2, mse) in enumerate(
                zip(cv_results[best_name]["fold_r2"], cv_results[best_name]["fold_mse"])
            )
        ]

        # Map display name → algorithm string stored in DB
        algo_map = {
            "random_forest":     "random_forest",
            "gradient_boosting": "gradient_boosting",
            "xgboost":           "xgboost",
        }

        model_id = self._save_model(
            model=best_model,
            name="book_popularity_regressor",
            algorithm=algo_map[best_name],
            model_type="regression",
            feature_names=['word_count', 'avg_word_length', 'file_size_mb'] + list(feature_names),
            target_column="popularity_score",
            scaler=scaler,
            metrics=metrics,
            cv_fold_metrics=cv_fold_metrics,
        )

        return {
            "model_id":         model_id,
            "best_model":       best_name,
            "cv_results":       cv_results,
            "metrics":          metrics,
            "cv_metrics":       cv_fold_metrics,
            "training_samples": len(X_train),
            "test_samples":     len(X_test),
        }

    # ==================== CLUSTERING MODELS (UNSUPERVISED) ====================

    def train_book_clustering(
        self, books: List[models.Book], n_clusters: int = None
    ) -> Dict[str, Any]:
        """
        Cluster books by content similarity using KMeans.
        Optimal k is chosen by silhouette score unless n_clusters is specified.
        """
        logger.info("Training book clustering...")

        books_with_content = [b for b in books if b.content and b.content.strip()]
        min_books_required = 10

        if len(books_with_content) < min_books_required:
            return {
                "error": (
                    f"Not enough books with content for clustering. "
                    f"Found: {len(books_with_content)}, need: {min_books_required}"
                )
            }

        df_features = self.extract_book_features(books_with_content)
        tfidf_features, feature_names, _ = self.create_text_features(
            books_with_content, max_features=200
        )

        if tfidf_features.shape[0] == 0:
            return {"error": "Could not extract text features"}

        numerical_features = df_features[['word_count', 'avg_word_length', 'file_size_mb']].values
        X = np.hstack([numerical_features, tfidf_features])

        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        max_clusters = min(10, len(books_with_content) // 3)
        if max_clusters < 2:
            return {
                "error": (
                    f"Not enough books for clustering. "
                    f"Need at least 6 books, have {len(books_with_content)}"
                )
            }

        silhouette_scores = []

        for k in range(2, max_clusters + 1):
            kmeans = KMeans(n_clusters=k, random_state=42, n_init=10)
            labels = kmeans.fit_predict(X_scaled)

            unique_labels, counts = np.unique(labels, return_counts=True)
            if len(unique_labels) == k and np.min(counts) >= 2:
                score = silhouette_score(X_scaled, labels)
                silhouette_scores.append({'n_clusters': k, 'silhouette': float(score)})
                logger.info(
                    "[CLUSTERING] k=%d | silhouette=%.4f | cluster sizes=%s",
                    k, score, dict(zip(unique_labels.tolist(), counts.tolist()))
                )
            else:
                logger.warning(
                    "[CLUSTERING] Skipping k=%d: insufficient cluster members. Sizes: %s",
                    k, dict(zip(unique_labels.tolist(), counts.tolist()))
                )

        if not silhouette_scores:
            return {"error": "Could not compute silhouette scores for any cluster configuration"}

        if n_clusters is None:
            best_silhouette = max(silhouette_scores, key=lambda x: x['silhouette'])
            optimal_clusters = best_silhouette['n_clusters']
            logger.info(
                "[CLUSTERING] Auto-selected k=%d (silhouette=%.4f)",
                optimal_clusters, best_silhouette['silhouette']
            )
        else:
            optimal_clusters = max(2, min(n_clusters, max_clusters))
            if optimal_clusters != n_clusters:
                logger.warning(
                    "[CLUSTERING] Requested k=%d clamped to k=%d (max for %d books)",
                    n_clusters, optimal_clusters, len(books_with_content)
                )
            best_auto = max(silhouette_scores, key=lambda x: x['silhouette'])
            if best_auto['n_clusters'] != optimal_clusters:
                requested_sil = next(
                    (s['silhouette'] for s in silhouette_scores if s['n_clusters'] == optimal_clusters), 0.0
                )
                logger.warning(
                    "[CLUSTERING] Using user-specified k=%d (silhouette=%.4f) vs "
                    "auto-selected k=%d (silhouette=%.4f)",
                    optimal_clusters, requested_sil,
                    best_auto['n_clusters'], best_auto['silhouette']
                )

        model = KMeans(n_clusters=optimal_clusters, random_state=42, n_init=10)
        cluster_labels = model.fit_predict(X_scaled)

        cluster_stats = []
        for i in range(optimal_clusters):
            cluster_books = [
                books_with_content[j]
                for j, label in enumerate(cluster_labels) if label == i
            ]
            if cluster_books:
                cluster_stats.append({
                    'cluster_id': i,
                    'size': len(cluster_books),
                    'percentage': len(cluster_books) / len(books_with_content) * 100,
                    'sample_titles': [b.title for b in cluster_books[:3]]
                })

        final_silhouette = (
            silhouette_score(X_scaled, cluster_labels)
            if len(set(cluster_labels)) > 1 else -1
        )

        logger.info(
            "[CLUSTERING] Final: k=%d | silhouette=%.4f | inertia=%.2f",
            optimal_clusters, final_silhouette, float(model.inertia_)
        )

        metrics = {
            'inertia': float(model.inertia_),
            'n_clusters': optimal_clusters,
            'silhouette_optimal': silhouette_scores,
            'silhouette_score': float(final_silhouette),
            'auto_selected': n_clusters is None,
            'total_books': len(books_with_content),
            'max_clusters_tested': max_clusters
        }

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

    def _save_model(
        self,
        model,
        name: str,
        algorithm: str,
        model_type: str,
        feature_names: List[str],
        target_column: Optional[str],
        metrics: Dict,
        cv_fold_metrics: Optional[List] = None,
        **kwargs
    ) -> int:
        """Save model to disk and database."""
        version = datetime.now().strftime("%Y%m%d_%H%M%S")

        model_filename = f"{name}_{version}.joblib"
        model_path = self.models_dir / model_filename
        joblib.dump({
            'model': model,
            'feature_names': feature_names,
            'target_column': target_column,
            **kwargs
        }, model_path)

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
        self.db.flush()

        for metric_name, metric_value in metrics.items():
            if isinstance(metric_value, (int, float)):
                self.db.add(models.ModelMetric(
                    model_id=db_model.id,
                    metric_name=metric_name,
                    metric_value=float(metric_value)
                ))

        if cv_fold_metrics:
            for fold_metric in cv_fold_metrics:
                for m_name, m_value in fold_metric.items():
                    if m_name != 'fold' and isinstance(m_value, (int, float)):
                        self.db.add(models.ModelMetric(
                            model_id=db_model.id,
                            metric_name=f"{m_name}_fold_{fold_metric['fold']}",
                            metric_value=float(m_value),
                            cv_fold=fold_metric['fold']
                        ))

        self.db.commit()
        self.db.refresh(db_model)

        with self.cache_lock:
            self.model_cache[db_model.id] = {
                'model': model,
                'metadata': kwargs
            }

        logger.info(
            "[SAVE] Model '%s' (v%s) saved — id=%d | path=%s",
            name, version, db_model.id, model_path
        )

        return db_model.id

    def load_model(self, model_id: int) -> Optional[Dict]:
        """Load model from cache or disk."""
        with self.cache_lock:
            if model_id in self.model_cache:
                return self.model_cache[model_id]

        db_model = self.db.query(models.MLModel).filter(
            models.MLModel.id == model_id,
            models.MLModel.status == "active"
        ).first()

        if not db_model or not db_model.file_path:
            return None

        try:
            model_data = joblib.load(db_model.file_path)

            with self.cache_lock:
                self.model_cache[model_id] = model_data

            return model_data
        except Exception as e:
            logger.error("Failed to load model %d: %s", model_id, e)
            return None

    # ==================== PREDICTION ====================

    def predict(self, model_id: int, features: Dict[str, Any]) -> Dict[str, Any]:
        """
        Make a prediction with a loaded model.
        Designed to be fast; prediction logging is async.
        """
        import time
        start_time = time.time()

        model_data = self.load_model(model_id)
        if not model_data:
            return {"error": "Model not found"}

        model = model_data['model']
        feature_names = model_data.get('feature_names', [])

        feature_vector = [features.get(fname, 0) for fname in feature_names]
        X = np.array([feature_vector])

        if 'scaler' in model_data:
            X = model_data['scaler'].transform(X)

        if hasattr(model, 'predict_proba'):
            pred_class = model.predict(X)[0]
            probabilities = model.predict_proba(X)[0]
            confidence = float(np.max(probabilities))

            if 'label_encoder' in model_data:
                pred_class = model_data['label_encoder'].inverse_transform([pred_class])[0]

            result = {
                'prediction': str(pred_class),
                'confidence': confidence,
                'probabilities': probabilities.tolist() if hasattr(probabilities, 'tolist') else probabilities
            }
        elif hasattr(model, 'predict'):
            pred = model.predict(X)[0]
            result = {
                'prediction': float(pred) if isinstance(pred, (np.floating, float)) else int(pred)
            }
        else:
            result = {"error": "Model doesn't support prediction"}

        prediction_time = (time.time() - start_time) * 1000  # ms
        self._store_prediction_async(model_id, features, result, prediction_time)

        return {
            **result,
            'prediction_time_ms': prediction_time,
            'model_id': model_id
        }

    def _store_prediction_async(
        self, model_id: int, features: Dict, prediction: Dict, time_ms: float
    ):
        """Store prediction record in a background thread."""
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
                logger.error("Failed to store prediction: %s", e)
            finally:
                if db_session:
                    db_session.close()

        self.executor.submit(_store)

    # ==================== BACKGROUND TRAINING ====================

    def train_all_models_background(self, clustering_clusters: int = None):
        """
        Kick off training for all models in a background thread.

        Args:
            clustering_clusters: Optional fixed k for KMeans. None = auto-select.
        """
        def _train():
            logger.info("=== Background model training started ===")

            books = self.db.query(models.Book).filter(
                models.Book.content.isnot(None)
            ).all()

            if len(books) < 10:
                logger.warning("Not enough books for training (found %d, need 10)", len(books))
                return

            # Author classifier
            try:
                if len([b for b in books if b.author]) >= 10:
                    result = self.train_author_classifier(books)
                    logger.info("Author classifier result: %s", result.get('metrics', {}))
                else:
                    logger.warning("Skipping author classifier — fewer than 10 books have authors")
            except Exception as e:
                logger.error("Author classifier failed: %s", e, exc_info=True)

            # Popularity regressor (RF vs GB vs XGB)
            try:
                if len(books) >= 20:
                    result = self.train_book_popularity_regressor(books)
                    logger.info(
                        "Popularity regressor result — best=%s | metrics=%s",
                        result.get('best_model'), result.get('metrics', {})
                    )
                else:
                    logger.warning("Skipping popularity regressor — fewer than 20 books")
            except Exception as e:
                logger.error("Popularity regressor failed: %s", e, exc_info=True)

            # Clustering
            try:
                if len(books) >= 10:
                    result = self.train_book_clustering(books, n_clusters=clustering_clusters)
                    logger.info("Clustering result: %s", result.get('metrics', {}))
                else:
                    logger.warning("Skipping clustering — fewer than 10 books")
            except Exception as e:
                logger.error("Clustering failed: %s", e, exc_info=True)

            logger.info("=== Background model training complete ===")

        self.executor.submit(_train)

    # ==================== MODEL ANALYSIS ====================

    def get_model_performance(self, model_id: int) -> Dict[str, Any]:
        """Get comprehensive model performance metrics from the database."""
        model = self.db.query(models.MLModel).filter(
            models.MLModel.id == model_id
        ).first()

        if not model:
            return {"error": "Model not found"}

        metrics = self.db.query(models.ModelMetric).filter(
            models.ModelMetric.model_id == model_id
        ).all()

        prediction_stats = self.db.query(
            func.count(models.ModelPrediction.id).label('total_predictions'),
            func.avg(models.ModelPrediction.prediction_time_ms).label('avg_prediction_time')
        ).filter(
            models.ModelPrediction.model_id == model_id
        ).first()

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
                "avg_prediction_time_ms": (
                    float(prediction_stats.avg_prediction_time)
                    if prediction_stats and prediction_stats.avg_prediction_time else 0
                )
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