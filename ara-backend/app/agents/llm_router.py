# app/agents/llm_router.py
import asyncio
from typing import Optional, Dict, Any
from litellm import acompletion
from app.config import get_settings
from app.utils.network import NetworkDetector
import logging

logger = logging.getLogger(__name__)

class LLMRouter:
    """Smart router that picks best available LLM at runtime"""
    
    def __init__(self):
        self.settings = get_settings()
        self.network = NetworkDetector()
        self.provider_history = []
    
    async def get_best_provider(self) -> Dict[str, Any]:
        """Runtime decision: pick best available provider NOW"""
        status = await self.network.get_status(self.settings.OLLAMA_BASE_URL)
        
        # FIXED PRIORITY: GitHub (free) > Ollama (local) > OpenAI > Anthropic
        # GitHub is first because it's free and high quality
        
        # 1. GitHub Models (free GPT-4o) - needs internet + token
        if status["internet"] and self.settings.GITHUB_TOKEN:
            return {
                "provider": "github",
                "model": "openai/gpt-4o",  # Full model name with vendor prefix
                "type": "cloud",
                "available": True,
                "needs_internet": True,
                "api_key": self.settings.GITHUB_TOKEN,
                "api_base": "https://models.github.ai/inference"
            }
        
        # 2. Ollama (local) - no internet needed, good fallback
        elif status["ollama"]:
            return {
                "provider": "ollama",
                "model": self.settings.OLLAMA_MODEL,
                "type": "local",
                "available": True,
                "needs_internet": False,
                "api_base": self.settings.OLLAMA_BASE_URL
            }
        
        # 3. OpenAI (paid) - needs internet + API key
        elif status["internet"] and self.settings.OPENAI_API_KEY:
            return {
                "provider": "openai",
                "model": self.settings.OPENAI_MODEL,
                "type": "cloud",
                "available": True,
                "needs_internet": True,
                "api_key": self.settings.OPENAI_API_KEY
            }
        
        # 4. Anthropic (paid) - needs internet + API key
        elif status["internet"] and self.settings.ANTHROPIC_API_KEY:
            return {
                "provider": "anthropic",
                "model": self.settings.ANTHROPIC_MODEL,
                "type": "cloud",
                "available": True,
                "needs_internet": True,
                "api_key": self.settings.ANTHROPIC_API_KEY
            }
        
        # 5. Nothing available
        else:
            return {
                "provider": None,
                "model": None,
                "type": None,
                "available": False,
                "needs_internet": False
            }
    
    async def generate(self, prompt: str, system_prompt: Optional[str] = None, temperature: float = 0.7) -> Dict[str, Any]:
        """Generate using best available provider at call time"""
        provider = await self.get_best_provider()
        
        if not provider["available"]:
            return {
                "error": "No LLM available - offline and no local model running",
                "provider": None,
                "content": None
            }
        
        logger.info(f"[LLM Router] Using {provider['provider']} - {provider['model']}")
        
        try:
            if provider["provider"] == "github":
                response = await self._call_github(prompt, provider["model"], system_prompt, temperature, provider)
            elif provider["provider"] == "ollama":
                response = await self._call_ollama(prompt, provider["model"], system_prompt, temperature)
            elif provider["provider"] == "openai":
                response = await self._call_openai(prompt, provider["model"], system_prompt, temperature)
            elif provider["provider"] == "anthropic":
                response = await self._call_anthropic(prompt, provider["model"], system_prompt, temperature)
            else:
                response = {"error": "Unknown provider"}
            
            self.provider_history.append({
                "provider": provider["provider"],
                "model": provider["model"],
                "timestamp": asyncio.get_event_loop().time()
            })
            
            return {
                "provider": provider["provider"],
                "model": provider["model"],
                "type": provider["type"],
                "content": response
            }
            
        except Exception as e:
            logger.error(f"Error with {provider['provider']}: {str(e)}")
            
            # If GitHub fails, try Ollama next
            if provider["provider"] == "github":
                logger.info("GitHub failed, trying Ollama...")
                return await self.generate_with_fallback_ollama(prompt, system_prompt, temperature)
            
            # If Ollama fails, try OpenAI
            elif provider["provider"] == "ollama" and self.settings.OPENAI_API_KEY:
                logger.info("Ollama failed, trying OpenAI...")
                return await self.generate_with_fallback_openai(prompt, system_prompt, temperature)
            
            return {
                "error": str(e),
                "provider": provider["provider"],
                "content": None
            }
    
    async def generate_with_fallback_ollama(self, prompt: str, system_prompt: Optional[str], temperature: float) -> Dict[str, Any]:
        """Try Ollama as fallback"""
        original_token = self.settings.GITHUB_TOKEN
        self.settings.GITHUB_TOKEN = None  # Disable GitHub to force Ollama
        
        try:
            result = await self.generate(prompt, system_prompt, temperature)
            return result
        finally:
            self.settings.GITHUB_TOKEN = original_token
    
    async def generate_with_fallback_openai(self, prompt: str, system_prompt: Optional[str], temperature: float) -> Dict[str, Any]:
        """Try OpenAI as fallback"""
        # This will naturally try OpenAI since GitHub is disabled and Ollama failed
        return await self.generate(prompt, system_prompt, temperature)
    
    async def _call_ollama(self, prompt: str, model: str, system_prompt: Optional[str], temperature: float) -> str:
        """Call local Ollama"""
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        
        response = await acompletion(
            model=f"ollama/{model}",
            messages=messages,
            temperature=temperature,
            api_base=self.settings.OLLAMA_BASE_URL
        )
        return response.choices[0].message.content
    
    async def _call_github(self, prompt: str, model: str, system_prompt: Optional[str], 
                          temperature: float, provider: Dict[str, Any]) -> str:
        """Call GitHub Models (free GPT-4o)"""
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        
        try:
            response = await acompletion(
                model=model,  # "openai/gpt-4o"
                messages=messages,
                temperature=temperature,
                api_key=provider["api_key"],
                api_base=provider["api_base"]  # "https://models.github.ai/inference"
            )
            return response.choices[0].message.content
        except Exception as e:
            logger.error(f"GitHub API call failed: {str(e)}")
            # Re-raise to trigger fallback
            raise
    
    async def _call_openai(self, prompt: str, model: str, system_prompt: Optional[str], temperature: float) -> str:
        """Call OpenAI (paid fallback)"""
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        
        response = await acompletion(
            model=model,
            messages=messages,
            temperature=temperature,
            api_key=self.settings.OPENAI_API_KEY
        )
        return response.choices[0].message.content
    
    async def _call_anthropic(self, prompt: str, model: str, system_prompt: Optional[str], temperature: float) -> str:
        """Call Anthropic Claude (paid fallback)"""
        messages = []
        if system_prompt:
            messages.append({"role": "user", "content": f"System: {system_prompt}\n\nUser: {prompt}"})
        else:
            messages.append({"role": "user", "content": prompt})
        
        response = await acompletion(
            model=model,
            messages=messages,
            temperature=temperature,
            api_key=self.settings.ANTHROPIC_API_KEY
        )
        return response.choices[0].message.content