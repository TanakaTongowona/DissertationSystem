from pydantic import BaseModel
from typing import Optional, List, Dict

class LibraryStats(BaseModel):
    total_books: int
    indexed_books: int
    pending_indexing: int
    external_books: int
    total_books_by_source: Dict[str, int]
    total_file_size_mb: float
    avg_file_size_mb: float

class BookGrowthData(BaseModel):
    date: str
    count: int
    cumulative: int

class IndexingProgress(BaseModel):
    indexed_percentage: float
    pending_count: int
    indexed_count: int

class PopularAuthors(BaseModel):
    author: str
    book_count: int
    indexed_count: int

class PopularSubjects(BaseModel):
    subject: str
    count: int

class PublicationDecadeStats(BaseModel):
    decade: str
    book_count: int
    indexed_count: int

class ResearchActivity(BaseModel):
    total_sessions: int
    avg_confidence: float
    sessions_last_30_days: int
    most_used_providers: Dict[str, int]
    popular_research_methods: Dict[str, int]

class ModelPerformanceMetrics(BaseModel):
    model_name: str
    model_type: str
    accuracy: Optional[float]
    f1_score: Optional[float]
    mse: Optional[float]
    training_time_seconds: float
    predictions_count: int
    last_used: Optional[str]

class DashboardOverview(BaseModel):
    library_stats: LibraryStats
    book_growth: List[BookGrowthData]
    indexing_progress: IndexingProgress
    popular_authors: List[PopularAuthors]
    popular_subjects: List[PopularSubjects]
    publication_timeline: List[PublicationDecadeStats]
    research_activity: ResearchActivity