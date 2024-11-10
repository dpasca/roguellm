from duckduckgo_search import DDGS
from duckduckgo_search.exceptions import DuckDuckGoSearchException
import time

def web_search(query, max_results=5):
    max_retries = 2
    for attempt in range(max_retries):
        try:
            with DDGS() as ddgs:
                results = [r for r in ddgs.text(query, max_results=max_results)]
            return results
        except DuckDuckGoSearchException as e:
            if attempt < max_retries - 1:
                print(f"DuckDuckGo search failed. Retrying in 5 seconds. Attempt {attempt + 1}/{max_retries}")
                time.sleep(5)
            else:
                print(f"DuckDuckGo search failed after {max_retries} attempts: {str(e)}")
                return []

    return []

if __name__ == "__main__":
    print(web_search("What is the weather in Tokyo?"))
