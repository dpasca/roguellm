from openai import AsyncOpenAI
from web_search import web_search
import asyncio
from openai import RateLimitError
import random
import logging
import httpx
import httpx
logger = logging.getLogger()

# Mapping of locale codes to full language names
LANGUAGE_MAP = {
    "en": "English",
    "it": "Italian",
    "ja": "Japanese",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "zh": "Chinese",
    "ko": "Korean",
    "ru": "Russian",
    "pt": "Portuguese"
}

def get_language_name(locale_code: str) -> str:
    """Convert a locale code to its full language name."""
    return LANGUAGE_MAP.get(locale_code, locale_code)

# Extract clean data for cases where the LLM still uses markdown
def extract_clean_data(data_str: str) -> str:
    import re

    # Try to find content between ```json and ``` markers
    json_match = re.search(r'```json\s*([\s\S]*?)\s*```', data_str)
    if json_match:
        return json_match.group(1).strip()

    # Try to find content between ```csv and ``` markers
    csv_match = re.search(r'```csv\s*([\s\S]*?)\s*```', data_str)
    if csv_match:
        return csv_match.group(1).strip()

    # Try to find content between generic ``` markers
    generic_match = re.search(r'```\s*([\s\S]*?)\s*```', data_str)
    if generic_match:
        return generic_match.group(1).strip()

    return data_str.strip()

async def with_exponential_backoff(func, max_retries=5, base_delay=2):
    """Execute a function with exponential backoff retry logic for rate limits and timeouts.
    
    Args:
        func: Async function to execute
        max_retries: Maximum number of retry attempts
        base_delay: Base delay in seconds (will be multiplied exponentially)
    
    The actual delay will be: base_delay * (2 ^ attempt) + random jitter
    For base_delay=2, the delays will be approximately:
    - First retry: 2-3 seconds
    - Second retry: 4-6 seconds
    - Third retry: 8-12 seconds
    - Fourth retry: 16-24 seconds
    """
    for attempt in range(max_retries):
        try:
            return await func()
        except (RateLimitError, httpx.ReadTimeout) as e:
            if attempt == max_retries - 1:
                raise  # Re-raise the exception if we've exhausted all retries
            
            # Calculate delay with jitter (±25% randomness)
            delay = base_delay * (2 ** attempt)
            jitter = delay * 0.5 * random.random()  # Up to 50% additional delay
            total_delay = delay + jitter
            
            error_type = "rate limit" if isinstance(e, RateLimitError) else "timeout"
            logger.warning(
                f"API {error_type} error, retrying in {total_delay:.1f} seconds... "
                f"(attempt {attempt + 1}/{max_retries})"
            )
            await asyncio.sleep(total_delay)
    
    raise Exception(f"Failed after {max_retries} retries")

# Given a theme description, generate a web search query and return the results
async def make_query_and_web_search(
        oai_client: AsyncOpenAI,
        model_name: str,
        subject_input: str,
        language: str) -> str:
    user_msg = f"""
Generate web search query to research on the following subject:
{subject_input}

---

# Response Format
Return ONLY the query, no additional text or explanations.
Do NOT wrap the query in quotes.
The language of the response must be: {get_language_name(language)}
"""
    logger.info(f"Requesting web search query: {user_msg}")
    
    async def get_completion():
        return await oai_client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": "You are an expert web search query generator."},
                {"role": "user", "content": user_msg}
            ],
            temperature=0.7
        )
    
    response = await with_exponential_backoff(get_completion)
    query = response.choices[0].message.content
    logger.info(f"Obtained web search query: {query}")
    query_result = web_search(query)
    logger.info(f"Web search results: {query_result}")
    return query_result
