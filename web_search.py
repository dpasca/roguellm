import os
from dotenv import load_dotenv
from duckduckgo_search import DDGS
from duckduckgo_search.exceptions import DuckDuckGoSearchException
from serpapi import GoogleSearch
import time

# Load environment variables
load_dotenv()

def search_with_duckduckgo(query, max_results=5):
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

def search_with_serpapi(query, max_results=5):
    api_key = os.getenv("SERPAPI_KEY")
    if not api_key:
        print("SerpApi key not found in environment variables")
        return []
    
    try:
        params = {
            "engine": "google",
            "q": query,
            "api_key": api_key,
            "num": max_results
        }
        search = GoogleSearch(params)
        results = search.get_dict()
        
        # Format results to match DuckDuckGo structure
        formatted_results = []
        if "organic_results" in results:
            for result in results["organic_results"][:max_results]:
                formatted_results.append({
                    "title": result.get("title", ""),
                    "link": result.get("link", ""),
                    "snippet": result.get("snippet", "")
                })
        return formatted_results
    except Exception as e:
        print(f"SerpApi search failed: {str(e)}")
        return []

def web_search(query, max_results=5, provider="duckduckgo"):
    """
    Perform web search using the specified provider.
    
    Args:
        query (str): Search query
        max_results (int): Maximum number of results to return
        provider (str): Search provider to use ("duckduckgo" or "serpapi")
        
    Returns:
        list: List of search results
    """
    if provider == "serpapi":
        return search_with_serpapi(query, max_results)
    else:  # default to duckduckgo
        return search_with_duckduckgo(query, max_results)

if __name__ == "__main__":
    # Test both providers
    print("DuckDuckGo results:")
    print(web_search("What is the weather in Tokyo?"))
    print("\nSerpApi results:")
    print(web_search("What is the weather in Tokyo?", provider="serpapi"))
