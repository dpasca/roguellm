from openai import OpenAI
from web_search import web_search

import logging
logger = logging.getLogger()

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

# Given a theme description, generate a web search query and return the results
def make_query_and_web_search(
        oai_client: OpenAI,
        model_name: str,
        subject_input: str,
        language: str) -> str:
    user_msg = f"""
Generate web search query to research on the following subject:
{subject_input}

---

# Response Format
Return ONLY the query, no additional text or explanations.
The language of the response must be: {language}
"""
    logger.info(f"Requesting web search query: {user_msg}")
    response = oai_client.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "system", "content": "You are an expert web search query generator."},
            {"role": "user", "content": user_msg}
        ],
        temperature=0.7
    )
    query = response.choices[0].message.content
    logger.info(f"Obtained web search query: {query}")
    query_result = web_search(query)
    logger.info(f"Web search results: {query_result}")
    return query_result

