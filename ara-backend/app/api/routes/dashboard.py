from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, desc, text
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from app.database import models
from app.auth_services import oauth2
from app.database.session import get_db
import csv
from io import StringIO
from fastapi.responses import Response
from app.schemas.dashboard import (
    DashboardOverview,
    BookGrowthData,
    PopularAuthors,
    PopularSubjects,
    IndexingProgress,
    LibraryStats,
    ResearchActivity,
    PublicationDecadeStats,
)


router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/overview", response_model=DashboardOverview)
async def get_dashboard_overview(
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db),
):
    """Get comprehensive dashboard overview with all metrics"""

    # 1. Library Statistics
    total_books = db.query(models.Book).count()
    indexed_books = (
        db.query(models.Book).filter(models.Book.embedding.isnot(None)).count()
    )

    # External books count
    external_books = (
        db.query(models.Book).filter(models.Book.external_source.isnot(None)).count()
    )

    # Books by source
    books_by_source = (
        db.query(models.Book.external_source, func.count(models.Book.id))
        .filter(models.Book.external_source.isnot(None))
        .group_by(models.Book.external_source)
        .all()
    )

    # File size stats
    file_size_result = (
        db.query(func.sum(models.Book.file_size), func.avg(models.Book.file_size))
        .filter(models.Book.file_size.isnot(None))
        .first()
    )

    total_size_mb = (file_size_result[0] or 0) / (1024 * 1024)
    avg_size_mb = (file_size_result[1] or 0) / (1024 * 1024)

    # 2. Book Growth Over Time (last 10 days) - MODIFIED
    ten_days_ago = datetime.now() - timedelta(days=10)
    growth_data = (
        db.query(
            func.date_trunc("day", models.Book.created_at).label("day"),
            func.count(models.Book.id).label("count"),
        )
        .filter(models.Book.created_at >= ten_days_ago)
        .group_by("day")
        .order_by("day")
        .all()
    )

    # Create a dictionary of all dates in the last 10 days
    current_date = ten_days_ago.date()
    end_date = datetime.now().date()

    # Generate all dates in the range
    all_dates = {}
    while current_date <= end_date:
        date_str = current_date.strftime("%Y-%m-%d")
        all_dates[date_str] = 0
        current_date += timedelta(days=1)

    # Fill in the counts for dates that have data
    for day, count in growth_data:
        if day:
            date_str = day.strftime("%Y-%m-%d")
            all_dates[date_str] = count

    # Calculate cumulative sum
    cumulative = 0
    book_growth = []
    for date_str in sorted(all_dates.keys()):
        cumulative += all_dates[date_str]
        book_growth.append(
            BookGrowthData(
                date=date_str, count=all_dates[date_str], cumulative=cumulative
            )
        )

    # 3. Popular Authors - TOP 5 ONLY
    popular_authors = (
        db.query(
            models.Book.author,
            func.count(models.Book.id).label("book_count"),
            func.count(func.nullif(models.Book.embedding, None)).label("indexed_count"),
        )
        .filter(models.Book.author.isnot(None), models.Book.author != "")
        .group_by(models.Book.author)
        .order_by(desc("book_count"))
        .limit(5)
        .all()
    )

    # 4. Popular Subjects - FIXED: Cast to jsonb and use proper function
    subjects_query = text(
        """
        SELECT 
            jsonb_array_elements_text(CAST(metadata_json AS jsonb)->'subjects') as subject,
            COUNT(*) as count
        FROM books
        WHERE metadata_json->'subjects' IS NOT NULL
          AND jsonb_array_length(CAST(metadata_json AS jsonb)->'subjects') > 0
        GROUP BY subject
        ORDER BY count DESC
        LIMIT 10
    """
    )
    subjects_result = db.execute(subjects_query).fetchall()

    # 5. Publication Timeline by Decade
    decades_query = text(
        """
        SELECT 
            CONCAT(FLOOR(EXTRACT(YEAR FROM date_published) / 10) * 10, 's') as decade,
            COUNT(*) as book_count,
            COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) as indexed_count
        FROM books
        WHERE date_published IS NOT NULL
        GROUP BY decade
        ORDER BY MIN(EXTRACT(YEAR FROM date_published))
    """
    )
    decades_result = db.execute(decades_query).fetchall()

    # 6. Research Activity
    if current_user.is_superuser:
        total_sessions = db.query(models.ResearchSession).count()
    else:
        total_sessions = db.query(models.ResearchSession).filter(
            models.ResearchSession.owner_id == current_user.id
        ).count()

    # Average confidence
    avg_confidence = db.query(func.avg(models.ResearchSession.confidence)).scalar() or 0

    # Sessions last 30 days
    thirty_days_ago = datetime.now() - timedelta(days=30)
    sessions_last_30 = (
        db.query(models.ResearchSession)
        .filter(models.ResearchSession.created_at >= thirty_days_ago)
        .count()
    )

    # Most used providers
    providers = db.query(models.ResearchSession.provider_used).all()
    provider_counts = {}
    for p in providers:
        if p[0]:
            if isinstance(p[0], dict):
                for provider in p[0].values():
                    if provider:
                        provider_counts[provider] = provider_counts.get(provider, 0) + 1

    # Popular research methods
    methods = (
        db.query(
            models.ResearchSession.research_method,
            func.count(models.ResearchSession.id),
        )
        .filter(
            models.ResearchSession.research_method.isnot(None),
            models.ResearchSession.research_method != "",
        )
        .group_by(models.ResearchSession.research_method)
        .all()
    )

    # Convert popular_authors to list of dicts for the response - already limited to 5
    popular_authors_list = []
    for author, book_count, indexed_count in popular_authors:
        if author:  # Skip None authors
            popular_authors_list.append(
                PopularAuthors(
                    author=author,
                    book_count=book_count,
                    indexed_count=indexed_count or 0,
                )
            )

    # Convert subjects result to list
    popular_subjects_list = []
    for subject, count in subjects_result:
        if subject:  # Skip None subjects
            popular_subjects_list.append(PopularSubjects(subject=subject, count=count))

    # Convert publication timeline
    publication_timeline_list = []
    for decade, book_count, indexed_count in decades_result:
        publication_timeline_list.append(
            PublicationDecadeStats(
                decade=decade, book_count=book_count, indexed_count=indexed_count or 0
            )
        )

    return DashboardOverview(
        library_stats=LibraryStats(
            total_books=total_books,
            indexed_books=indexed_books,
            pending_indexing=total_books - indexed_books,
            external_books=external_books,
            total_books_by_source={
                src or "unknown": cnt for src, cnt in books_by_source
            },
            total_file_size_mb=round(total_size_mb, 2),
            avg_file_size_mb=round(avg_size_mb, 2),
        ),
        book_growth=book_growth,
        indexing_progress=IndexingProgress(
            indexed_percentage=(
                (indexed_books / total_books * 100) if total_books > 0 else 0
            ),
            pending_count=total_books - indexed_books,
            indexed_count=indexed_books,
        ),
        popular_authors=popular_authors_list,
        popular_subjects=popular_subjects_list,
        publication_timeline=publication_timeline_list,
        research_activity=ResearchActivity(
            total_sessions=total_sessions,
            avg_confidence=round(avg_confidence, 3),
            sessions_last_30_days=sessions_last_30,
            most_used_providers=provider_counts,
            popular_research_methods={method: count for method, count in methods},
        ),
    )


@router.get("/library/insights")
async def get_library_insights(
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db),
):
    """Detailed library insights and analytics"""

    # Books with and without embeddings over time - last 30 days instead of 12 months
    thirty_days_ago = datetime.now() - timedelta(days=30)
    indexing_trend = (
        db.query(
            func.date_trunc("day", models.Book.created_at).label("day"),
            func.count(func.nullif(models.Book.embedding, None)).label("indexed"),
            func.count(models.Book.id).label("total"),
        )
        .filter(models.Book.created_at >= thirty_days_ago)
        .group_by("day")
        .order_by("day")
        .all()
    )

    # Most prolific authors with highest indexing rates - TOP 5
    author_productivity = (
        db.query(
            models.Book.author,
            func.count(models.Book.id).label("total_books"),
            func.count(func.nullif(models.Book.embedding, None)).label("indexed_books"),
            (
                func.count(func.nullif(models.Book.embedding, None)).cast(float)
                / func.count(models.Book.id)
            ).label("index_rate"),
        )
        .filter(models.Book.author.isnot(None), models.Book.author != "")
        .group_by(models.Book.author)
        .having(func.count(models.Book.id) >= 3)
        .order_by(desc("index_rate"))
        .limit(5)
        .all()
    )

    # Subject diversity - FIXED: Cast to jsonb
    subject_diversity = text(
        """
        SELECT 
            COUNT(DISTINCT jsonb_array_elements_text(CAST(metadata_json AS jsonb)->'subjects')) as unique_subjects,
            COUNT(*) as total_subject_assignments,
            AVG(jsonb_array_length(CAST(metadata_json AS jsonb)->'subjects')) as avg_subjects_per_book
        FROM books
        WHERE metadata_json->'subjects' IS NOT NULL
          AND jsonb_array_length(CAST(metadata_json AS jsonb)->'subjects') > 0
    """
    )
    subject_stats = db.execute(subject_diversity).first()

    # Generate all dates for the last 30 days
    date_range = {}
    current_date = thirty_days_ago.date()
    end_date = datetime.now().date()

    while current_date <= end_date:
        date_str = current_date.strftime("%Y-%m-%d")
        date_range[date_str] = {"indexed": 0, "total": 0}
        current_date += timedelta(days=1)

    # Fill in the counts
    for day, indexed, total in indexing_trend:
        if day:
            date_str = day.strftime("%Y-%m-%d")
            if date_str in date_range:
                date_range[date_str] = {"indexed": indexed, "total": total}

    # Convert to list for response
    indexing_trend_list = []
    for date_str in sorted(date_range.keys()):
        indexing_trend_list.append(
            {
                "date": date_str,
                "indexed": date_range[date_str]["indexed"],
                "total": date_range[date_str]["total"],
            }
        )

    return {
        "indexing_trend": indexing_trend_list,
        "author_productivity": [
            {
                "author": author,
                "total_books": total,
                "indexed_books": indexed,
                "index_rate": round(index_rate, 2) if index_rate else 0,
            }
            for author, total, indexed, index_rate in author_productivity
        ],
        "subject_diversity": {
            "unique_subjects": subject_stats[0] if subject_stats else 0,
            "total_subject_assignments": subject_stats[1] if subject_stats else 0,
            "avg_subjects_per_book": (
                round(subject_stats[2], 2) if subject_stats and subject_stats[2] else 0
            ),
        },
    }


@router.get("/research/analytics")
async def get_research_analytics(
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db),
    days: int = Query(90, ge=1, le=365),
):
    """Research session analytics and trends"""

    start_date = datetime.now() - timedelta(days=days)

    # Daily research activity
    daily_activity = (
        db.query(
            func.date_trunc("day", models.ResearchSession.created_at).label("day"),
            func.count(models.ResearchSession.id).label("sessions"),
            func.avg(models.ResearchSession.confidence).label("avg_confidence"),
        )
        .filter(models.ResearchSession.created_at >= start_date)
        .group_by("day")
        .order_by("day")
        .all()
    )

    # Generate all dates for the range
    date_range = {}
    current_date = start_date.date()
    end_date = datetime.now().date()

    while current_date <= end_date:
        date_str = current_date.strftime("%Y-%m-%d")
        date_range[date_str] = {"sessions": 0, "avg_confidence": 0}
        current_date += timedelta(days=1)

    # Fill in the counts
    for day, sessions, avg_conf in daily_activity:
        if day:
            date_str = day.strftime("%Y-%m-%d")
            if date_str in date_range:
                date_range[date_str] = {
                    "sessions": sessions,
                    "avg_confidence": avg_conf or 0,
                }

    # Convert to list for response
    daily_activity_list = []
    for date_str in sorted(date_range.keys()):
        daily_activity_list.append(
            {
                "date": date_str,
                "sessions": date_range[date_str]["sessions"],
                "avg_confidence": round(date_range[date_str]["avg_confidence"], 3),
            }
        )

    # Session duration
    session_durations = (
        db.query(
            func.avg(
                func.extract(
                    "epoch",
                    models.ResearchSession.completed_at
                    - models.ResearchSession.created_at,
                )
                / 60
            ).label("avg_duration_minutes"),
            func.max(
                func.extract(
                    "epoch",
                    models.ResearchSession.completed_at
                    - models.ResearchSession.created_at,
                )
                / 60
            ).label("max_duration_minutes"),
        )
        .filter(
            models.ResearchSession.completed_at.isnot(None),
            models.ResearchSession.created_at >= start_date,
        )
        .first()
    )

    # Research topics over time
    topics = (
        db.query(models.ResearchSession.query, models.ResearchSession.created_at)
        .filter(models.ResearchSession.created_at >= start_date)
        .order_by(desc(models.ResearchSession.created_at))
        .limit(50)
        .all()
    )

    # Confidence distribution
    confidence_dist = (
        db.query(
            func.floor(models.ResearchSession.confidence * 10).label("bucket"),
            func.count(models.ResearchSession.id).label("count"),
        )
        .filter(models.ResearchSession.confidence.isnot(None))
        .group_by("bucket")
        .order_by("bucket")
        .all()
    )

    return {
        "daily_activity": daily_activity_list,
        "session_metrics": {
            "avg_duration_minutes": (
                round(session_durations[0], 2)
                if session_durations and session_durations[0]
                else 0
            ),
            "max_duration_minutes": (
                round(session_durations[1], 2)
                if session_durations and session_durations[1]
                else 0
            ),
        },
        "recent_topics": [
            {"query": query, "date": created_at.isoformat()}
            for query, created_at in topics
        ],
        "confidence_distribution": [
            {"confidence_range": f"{bucket/10:.0f}-{(bucket+1)/10:.0f}", "count": count}
            for bucket, count in confidence_dist
        ],
    }


@router.get("/export/stats")
async def export_dashboard_stats(
    current_user: models.User = Depends(oauth2.get_current_user),
    db: Session = Depends(get_db),
    format: str = Query("json", regex="^(json|csv)$"),
):
    """Export dashboard statistics in JSON or CSV format"""

    # Get all stats
    stats = await get_dashboard_overview(current_user, db)

    if format == "csv":
        # Convert to CSV format

        output = StringIO()
        writer = csv.writer(output)

        # Library stats
        writer.writerow(["Metric", "Value"])
        writer.writerow(["Total Books", stats.library_stats.total_books])
        writer.writerow(["Indexed Books", stats.library_stats.indexed_books])
        writer.writerow(["Pending Indexing", stats.library_stats.pending_indexing])
        writer.writerow(["External Books", stats.library_stats.external_books])
        writer.writerow(["Total Size (MB)", stats.library_stats.total_file_size_mb])
        writer.writerow(["Average Size (MB)", stats.library_stats.avg_file_size_mb])

        # Popular authors (top 5)
        writer.writerow([])
        writer.writerow(["Popular Authors (Top 5)", "Book Count", "Indexed Count"])
        for author in stats.popular_authors[:5]:
            writer.writerow([author.author, author.book_count, author.indexed_count])

        # Popular subjects
        writer.writerow([])
        writer.writerow(["Popular Subjects (Top 10)", "Count"])
        for subject in stats.popular_subjects[:10]:
            writer.writerow([subject.subject, subject.count])

        # Book growth last 5 days
        writer.writerow([])
        writer.writerow(["Book Growth (Last 5 Days)", "New Books", "Cumulative"])
        for growth in stats.book_growth:
            writer.writerow([growth.date, growth.count, growth.cumulative])

        # Research activity
        writer.writerow([])
        writer.writerow(["Research Activity", "Value"])
        writer.writerow(["Total Sessions", stats.research_activity.total_sessions])
        writer.writerow(["Avg Confidence", stats.research_activity.avg_confidence])
        writer.writerow(
            ["Sessions (30d)", stats.research_activity.sessions_last_30_days]
        )

        return Response(
            content=output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=dashboard_stats.csv"},
        )

    return stats
