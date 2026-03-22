import json
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from sentence_transformers import SentenceTransformer
from app.database import models
from app.agents.llm_router import LLMRouter
from app.config import get_settings
import logging
from sqlalchemy import text
from enum import Enum
from datetime import datetime

logger = logging.getLogger(__name__)

class ResearchMethod(str, Enum):
    """Research methods matching your UI options"""
    LIBRARY_ONLY = "library_only"
    LLM_GENERAL = "llm_general"
    SUGGEST_BOOKS = "suggest_books"
    WEB_FALLBACK = "web_fallback"
    ALL = "all"

class ResearchAgent:
    """Deep thinking agent for academic research with multiple methods"""
    
    def __init__(self, db: Session):
        self.db = db
        self.settings = get_settings()
        self.llm_router = LLMRouter()
        
        # Load embedding model (runs locally)
        self.encoder = SentenceTransformer('all-MiniLM-L6-v2')
        
        # Track research steps for transparency
        self.research_log = []
        self.confidence_score = 0.0
        self.source_type = "none"
        self.research_plan = []
        self.filter_info = None
    
    async def retrieve_relevant_books(self, query: str, top_k: int = 5, min_similarity: float = 0.3, start_date: Optional[datetime] = None, end_date: Optional[datetime] = None) -> List[Dict]:
        """Retrieve relevant books using semantic search with quality threshold and optional date range filtering"""
        query_embedding = self.encoder.encode(query).tolist()
                
        # Base query
        sql = """
            SELECT id, title, author, content, file_path, date_published,
                1 - (embedding <=> CAST(:query_embedding AS vector)) as similarity
            FROM books
            WHERE embedding IS NOT NULL
        """
        
        params = {"query_embedding": query_embedding, "top_k": top_k}
        
        # Add date filters if provided
        if start_date and end_date:
            sql += " AND date_published BETWEEN :start_date AND :end_date"
            params["start_date"] = start_date
            params["end_date"] = end_date
            logger.info(f"Filtering books between {start_date} and {end_date}")
        elif start_date:
            sql += " AND date_published >= :start_date"
            params["start_date"] = start_date
            logger.info(f"Filtering books published after {start_date}")
        elif end_date:
            sql += " AND date_published <= :end_date"
            params["end_date"] = end_date
            logger.info(f"Filtering books published before {end_date}")
        
        sql += """
            ORDER BY embedding <=> CAST(:query_embedding AS vector)
            LIMIT :top_k
        """
        
        result = self.db.execute(text(sql), params)
        
        books = []
        total_considered = 0
        for row in result:
            total_considered += 1
            similarity = float(row[6])  # Index 6 is similarity
            # Only include if above threshold
            if similarity >= min_similarity:
                books.append({
                    "id": row[0],
                    "title": row[1],
                    "author": row[2],
                    "content": row[3][:2000] if row[3] else None,
                    "file_path": row[4],
                    "date_published": row[5].isoformat() if row[5] else None,
                    "similarity": similarity
                })
        
        # Store filter info
        if start_date or end_date:
            self.filter_info = {
                "applied": True,
                "start_date": start_date.isoformat() if start_date else None,
                "end_date": end_date.isoformat() if end_date else None,
                "books_found": len(books),
                "total_books_considered": total_considered
            }
        
        logger.info(f"Retrieved {len(books)} relevant books above threshold {min_similarity}" + 
                    (f" published between {start_date} and {end_date}" if start_date and end_date else
                     f" published after {start_date}" if start_date else
                     f" published before {end_date}" if end_date else ""))
        return books
    
    async def create_research_plan(self, query: str, books: List[Dict]) -> List[str]:
        """Step 1: Create a research plan - returns list of steps"""
        system_prompt = """You are a senior academic researcher. Create a detailed research plan to answer the user's query. Break down complex questions into clear, actionable steps."""
        
        books_context = ""
        if books:
            books_context = f"\nAvailable Books:\n{json.dumps([{
                'title': b['title'],
                'author': b['author'],
                'relevance': b['similarity'],
                'date_published': b.get('date_published')
            } for b in books[:3]], indent=2)}"
        
        prompt = f"""
Research Query: {query}{books_context}

Create a step-by-step research plan with 3-5 clear steps. 
Each step should be a complete sentence describing what to investigate.

Format your response as a JSON array of strings:
["Step 1: ...", "Step 2: ...", "Step 3: ..."]
"""
        
        result = await self.llm_router.generate(prompt, system_prompt=system_prompt, temperature=0.3)
        content = result.get("content", "[]")
        
        # Try to parse JSON, fallback to line-by-line
        try:
            # Extract JSON if wrapped in markdown
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            elif "```" in content:
                content = content.split("```")[1].split("```")[0].strip()
            
            plan = json.loads(content)
            if isinstance(plan, list):
                return plan
        except:
            # Fallback: split by lines
            lines = content.strip().split('\n')
            plan = [line.strip('-• ') for line in lines if line.strip()][:5]
        
        self.research_log.append({
            "step": "planning",
            "provider": result.get("provider"),
            "model": result.get("model")
        })
        
        return plan if plan else ["Analyze the query", "Gather relevant information", "Synthesize findings"]
    
    async def synthesize_answer(self, query: str, plan: List[str], books: List[Dict], method: ResearchMethod) -> str:
        """Synthesize answer using appropriate method"""
        
        # Add date context if filter was applied
        date_context = ""
        if self.filter_info and self.filter_info["applied"]:
            if self.filter_info.get("start_date") and self.filter_info.get("end_date"):
                date_context = f"\nNote: Research limited to books published between {self.filter_info['start_date'][:10]} and {self.filter_info['end_date'][:10]}. Found {self.filter_info['books_found']} relevant books from this period."
            elif self.filter_info.get("start_date"):
                date_context = f"\nNote: Research limited to books published after {self.filter_info['start_date'][:10]}. Found {self.filter_info['books_found']} relevant books from this period."
            elif self.filter_info.get("end_date"):
                date_context = f"\nNote: Research limited to books published before {self.filter_info['end_date'][:10]}. Found {self.filter_info['books_found']} relevant books from this period."
        
        # Build context based on method
        if method == ResearchMethod.LIBRARY_ONLY and books:
            context = self._build_library_context(books) + date_context
            system_prompt = """You are an academic research assistant. Synthesize information ONLY from the provided books. If the books don't fully answer the query, acknowledge the gaps."""
            self.source_type = "library"
            self.confidence_score = min(0.9, sum(b['similarity'] for b in books) / len(books))
            
        elif method == ResearchMethod.LLM_GENERAL:
            context = "No books available - use your general knowledge." + date_context
            system_prompt = """You are an academic research assistant. Answer using your general knowledge, but clearly indicate when information comes from general knowledge rather than specific sources."""
            self.source_type = "llm_general"
            self.confidence_score = 0.5
            
        elif method == ResearchMethod.WEB_FALLBACK:
            # For now, fallback to general knowledge with web indication
            context = "No books available - using general knowledge (web fallback mode)." + date_context
            system_prompt = """You are an academic research assistant. Answer using your general knowledge as if you had searched the web. Mention that this information comes from general knowledge."""
            self.source_type = "web"
            self.confidence_score = 0.4
            
        elif method == ResearchMethod.SUGGEST_BOOKS:
            return await self._suggest_books(query, date_context)
            
        else:  # ALL - use whatever's available
            if books:
                context = self._build_library_context(books) + date_context
                system_prompt = """You are an academic research assistant. Synthesize information from the provided books. If needed, supplement with your general knowledge."""
                self.source_type = "hybrid"
                self.confidence_score = min(0.85, sum(b['similarity'] for b in books) / len(books))
            else:
                context = "No books available - use your general knowledge." + date_context
                system_prompt = """You are an academic research assistant. Answer using your general knowledge."""
                self.source_type = "llm_general"
                self.confidence_score = 0.5
        
        prompt = f"""
Research Query: {query}

Research Plan:
{chr(10).join(f'{i+1}. {step}' for i, step in enumerate(plan))}

{context}

Provide a comprehensive answer that:
1. Directly addresses the original query
2. Follows the research plan
3. Includes citations where applicable [Book: Title]
4. Highlights any limitations in the available information
{'- Note the date filter applied to this research' if self.filter_info and self.filter_info['applied'] else ''}
"""
        
        result = await self.llm_router.generate(prompt, system_prompt=system_prompt, temperature=0.3)
        
        self.research_log.append({
            "step": "synthesis",
            "provider": result.get("provider"),
            "model": result.get("model")
        })
        
        return result.get("content", "Failed to synthesize answer")
    
    def _build_library_context(self, books: List[Dict]) -> str:
        """Build context from books including publication dates"""
        context_parts = ["Available Books and Excerpts:"]
        for i, book in enumerate(books[:5], 1):
            date_str = f" (Published: {book['date_published'][:10]})" if book.get('date_published') else ""
            context_parts.append(f"""
SOURCE {i}: {book['title']} by {book['author']}{date_str}
Relevance: {book['similarity']:.2%}
Excerpt: {book['content']}
---""")
        return "\n".join(context_parts)
    
    async def _suggest_books(self, query: str, date_context: str = "") -> str:
        """Suggest books to add to library with date awareness"""
        self.source_type = "suggestion"
        self.confidence_score = 0.8
        
        system_prompt = """You are a academic librarian. Suggest authoritative books that would help answer the user's query. Focus on well-known, respected academic texts."""
        
        prompt = f"""
The user asked: "{query}"

This topic is NOT covered in their current book library.{date_context}

Based on this query, recommend 3-5 authoritative books they should acquire.
For each book, provide:
- Title and author
- Publication year (if known)
- Why it's essential for this topic
- What specific aspects it would help with

If date filtering was applied, prioritize books published within the specified date range.

Format as a helpful, organized list.
"""
        
        result = await self.llm_router.generate(prompt, system_prompt=system_prompt)
        
        return result.get("content", "Unable to generate book suggestions at this time.")
    
    async def research(self, query: str, method: ResearchMethod = ResearchMethod.ALL, 
                      top_k: int = 5, owner_id: int = None, start_date: Optional[datetime] = None, end_date: Optional[datetime] = None) -> Dict[str, Any]:
        """Main research pipeline with method selection and date range filtering"""
        logger.info(f"Starting research on: {query} with method: {method}" + 
                    (f" (filter: {start_date} to {end_date})" if start_date or end_date else ""))
        
        # Reset state
        self.research_log = []
        self.confidence_score = 0.0
        self.source_type = "none"
        self.research_plan = []
        self.filter_info = None
        
        try:
            # Step 1: Retrieve books with date range filters
            books = await self.retrieve_relevant_books(query, top_k, start_date=start_date, end_date=end_date)
            
            # Add date filter info to research log
            if start_date or end_date:
                filter_desc = ""
                if start_date and end_date:
                    filter_desc = f"published between {start_date.strftime('%Y-%m-%d')} and {end_date.strftime('%Y-%m-%d')}"
                elif start_date:
                    filter_desc = f"published after {start_date.strftime('%Y-%m-%d')}"
                elif end_date:
                    filter_desc = f"published before {end_date.strftime('%Y-%m-%d')}"
                    
                self.research_log.append({
                    "step": "filtering",
                    "filter": filter_desc,
                    "books_found": len(books),
                    "total_considered": self.filter_info.get("total_books_considered", 0) if self.filter_info else 0
                })
            
            # Step 2: Determine which method to use based on books and user selection
            selected_method = method
            if method == ResearchMethod.ALL:
                if books:
                    selected_method = ResearchMethod.LIBRARY_ONLY
                else:
                    # Check if we have LLM available
                    provider = await self.llm_router.get_best_provider()
                    if provider["available"]:
                        selected_method = ResearchMethod.LLM_GENERAL
                    else:
                        selected_method = ResearchMethod.SUGGEST_BOOKS
            
            # Special case: If user selected LIBRARY_ONLY but no books found
            if method == ResearchMethod.LIBRARY_ONLY and not books:
                date_range_msg = ""
                if start_date and end_date:
                    date_range_msg = f" published between {start_date.strftime('%Y-%m-%d')} and {end_date.strftime('%Y-%m-%d')}"
                elif start_date:
                    date_range_msg = f" published after {start_date.strftime('%Y-%m-%d')}"
                elif end_date:
                    date_range_msg = f" published before {end_date.strftime('%Y-%m-%d')}"
                
                answer = f"No relevant books found in your library{date_range_msg}. Try enabling web fallback or general knowledge mode, or adjust your date filters."
                self.source_type = "none"
                self.confidence_score = 0.0
                
                # Create research session record even for this case
                research_session = models.ResearchSession(
                    query=query,
                    plan=json.dumps([]),
                    answer=answer,
                    owner_id=owner_id,
                    research_method=method.value if method else None,
                    sources=[],
                    provider_used=self.research_log,
                    confidence=self.confidence_score,
                    source_type=self.source_type,
                    filter_info=self.filter_info
                )
                
                self.db.add(research_session)
                self.db.commit()
                self.db.refresh(research_session)
                
                return {
                    "id": research_session.id,
                    "query": query,
                    "research_plan": [],
                    "answer": answer,
                    "sources": [],
                    "provider_log": self.research_log,
                    "status": "no_sources",
                    "confidence": self.confidence_score,
                    "source_type": self.source_type,
                    "provider": "none",
                    "research_method": method,
                    "filter_info": self.filter_info
                }
            
            # Step 3: Create research plan (if we're going to generate an answer)
            if selected_method != ResearchMethod.SUGGEST_BOOKS:
                self.research_plan = await self.create_research_plan(query, books)
            else:
                self.research_plan = ["Suggest relevant books for this topic"]
            
            # Step 4: Generate answer or suggestions
            if selected_method == ResearchMethod.SUGGEST_BOOKS:
                answer = await self._suggest_books(query)
            else:
                answer = await self.synthesize_answer(query, self.research_plan, books, selected_method)
            
            # Get the provider that was used
            provider_info = self.research_log[-1] if self.research_log else {"provider": "none", "model": "none"}
            
            # Create research session record with confidence, source_type, and filter_info
            research_session = models.ResearchSession(
                query=query,
                plan=json.dumps(self.research_plan),
                answer=answer,
                owner_id=owner_id,
                research_method=selected_method.value if selected_method else None,
                sources=[{"title": b["title"], "similarity": b["similarity"], "date_published": b.get("date_published")} for b in books[:5]],
                provider_used=self.research_log,
                confidence=self.confidence_score,
                source_type=self.source_type,
                filter_info=self.filter_info
            )
            
            self.db.add(research_session)
            self.db.commit()
            self.db.refresh(research_session)
            
            return {
                "id": research_session.id,
                "query": query,
                "research_plan": self.research_plan,
                "answer": answer,
                "sources": [{"title": b["title"], "similarity": b["similarity"], "date_published": b.get("date_published")} for b in books[:5]],
                "provider_log": self.research_log,
                "status": "completed",
                "confidence": self.confidence_score,
                "source_type": self.source_type,
                "provider": provider_info.get("provider", "none"),
                "research_method": selected_method,
                "filter_info": self.filter_info
            }
            
        except Exception as e:
            logger.error(f"Research failed: {e}")
            
            # Create error session with confidence and source_type
            error_session = models.ResearchSession(
                query=query,
                plan=json.dumps([]),
                answer=f"An error occurred during research: {str(e)}",
                owner_id=owner_id,
                research_method=method.value if method else None,
                sources=[],
                provider_used=self.research_log,
                confidence=0.0,
                source_type="error",
                filter_info=self.filter_info
            )
            
            self.db.add(error_session)
            self.db.commit()
            self.db.refresh(error_session)
            
            return {
                "id": error_session.id,
                "query": query,
                "research_plan": [],
                "answer": f"An error occurred during research: {str(e)}",
                "sources": [],
                "provider_log": self.research_log,
                "status": "error",
                "confidence": 0.0,
                "source_type": "error",
                "provider": "none",
                "research_method": method,
                "filter_info": self.filter_info
            }