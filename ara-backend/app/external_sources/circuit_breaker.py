# app/external_sources/circuit_breaker.py
from datetime import datetime, timedelta
from enum import Enum
import logging

logger = logging.getLogger(__name__)

class CircuitState(Enum):
    CLOSED = "closed"      # Normal operation
    OPEN = "open"          # Failing, don't try
    HALF_OPEN = "half_open" # Testing if recovered

class CircuitBreaker:
    """
    Circuit breaker pattern to prevent hammering failing APIs
    """
    
    def __init__(self, 
                 failure_threshold: int = 5,
                 recovery_timeout: int = 60,
                 name: str = "default"):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.name = name
        
        self.state = CircuitState.CLOSED
        self.failure_count = 0
        self.last_failure_time = None
        self.total_failures = 0
        self.total_successes = 0
    
    async def call(self, func, *args, **kwargs):
        """Execute function with circuit breaker protection"""
        
        # Check if circuit is open
        if self.state == CircuitState.OPEN:
            # Check if recovery timeout has elapsed
            if self.last_failure_time and \
               datetime.now() - self.last_failure_time > timedelta(seconds=self.recovery_timeout):
                logger.info(f"Circuit {self.name} moving to HALF_OPEN after timeout")
                self.state = CircuitState.HALF_OPEN
            else:
                logger.debug(f"Circuit {self.name} is OPEN, fast failing")
                raise Exception(f"Circuit {self.name} is OPEN")
        
        try:
            # Execute the function
            result = await func(*args, **kwargs)
            
            # Handle success
            self.total_successes += 1
            
            if self.state == CircuitState.HALF_OPEN:
                # Success in half-open state closes the circuit
                logger.info(f"Circuit {self.name} closing after successful test")
                self.state = CircuitState.CLOSED
                self.failure_count = 0
            
            return result
            
        except Exception as e:
            # Handle failure
            self.total_failures += 1
            self.last_failure_time = datetime.now()
            
            if self.state == CircuitState.HALF_OPEN:
                # Failure in half-open reopens circuit
                logger.warning(f"Circuit {self.name} reopening after half-open failure")
                self.state = CircuitState.OPEN
            else:
                self.failure_count += 1
                if self.failure_count >= self.failure_threshold:
                    logger.warning(f"Circuit {self.name} opening after {self.failure_count} failures")
                    self.state = CircuitState.OPEN
            
            raise e
    
    def get_stats(self) -> dict:
        """Get circuit breaker statistics"""
        return {
            "name": self.name,
            "state": self.state.value,
            "failure_count": self.failure_count,
            "total_failures": self.total_failures,
            "total_successes": self.total_successes,
            "success_rate": (self.total_successes / (self.total_successes + self.total_failures) * 100 
                           if (self.total_successes + self.total_failures) > 0 else 100)
        }