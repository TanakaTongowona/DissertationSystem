# app/config.py
from pydantic_settings import BaseSettings
from typing import Optional
from functools import lru_cache

class Settings(BaseSettings):
    # Database
    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = "tanaka2003"
    POSTGRES_DB: str = "academic_db"
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: str = "5432"
    
    # Ollama (Your local fallback)
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "gemma3:4b"
    OLLAMA_EMBEDDING_MODEL: str = "nomic-embed-text"
    
    # GitHub Models (FREE GPT-4o - Priority!)
    GITHUB_TOKEN: Optional[str] = "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"  # Your GitHub PAT
    # REMOVED: GITHUB_MODELS_BASE_URL - litellm handles this
    
    GOOGLE_BOOKS_API_KEY: Optional[str] = None
    CROSSREF_API_KEY: Optional[str] = None

    # OpenAI (Paid - Fallback)
    OPENAI_API_KEY: Optional[str] = None
    OPENAI_MODEL: str = "gpt-4-turbo-preview"
    
    # Anthropic (Paid - Fallback)
    ANTHROPIC_API_KEY: Optional[str] = None
    ANTHROPIC_MODEL: str = "claude-3-haiku-20240307"
    
    # Application
    BOOKS_FOLDER: str = "./books"
    UPLOAD_FOLDER: str = "./uploads"
    MAX_UPLOAD_SIZE: int = 50 * 1024 * 1024  # 50MB
    
    # Embedding
    EMBEDDING_DIM: int = 384
    
    class Config:
        env_file = ".env"


@lru_cache()
def get_settings():
    return Settings()