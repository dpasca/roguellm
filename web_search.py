import os
from dotenv import load_dotenv
from duckduckgo_search import DDGS
from duckduckgo_search.exceptions import DuckDuckGoSearchException
from serpapi import GoogleSearch
import time

# Load environment variables
load_dotenv()

# Default provider priority list - first provider will be tried first
PROVIDER_PRIORITY = ["duckduckgo", "serpapi"]

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

def web_search(query, max_results=5, providers=None):
    """
    Perform web search using multiple providers with automatic fallback.

    Args:
        query (str): Search query
        max_results (int): Maximum number of results to return
        providers (list): List of providers to try in order. If None, uses default priority.

    Returns:
        list: List of search results from the first successful provider
    """
    if providers is None:
        providers = PROVIDER_PRIORITY

    for provider in providers:
        print(f"Trying {provider}...")

        if provider == "serpapi":
            results = search_with_serpapi(query, max_results)
        elif provider == "duckduckgo":
            results = search_with_duckduckgo(query, max_results)
        else:
            print(f"Unknown provider: {provider}")
            continue

        if results:  # If we got results, return them
            print(f"Successfully got {len(results)} results from {provider}")
            return results
        else:
            print(f"No results from {provider}, trying next provider...")

    print("All providers failed or returned no results")
    return []

if __name__ == "__main__":
    # Test the new fallback functionality
    print("Testing automatic fallback:")
    results = web_search("What is the weather in Tokyo?")
    print(f"Got {len(results)} results")

    print("\nTesting with custom provider order:")
    results = web_search("What is the weather in Tokyo?", providers=["serpapi", "duckduckgo"])
    print(f"Got {len(results)} results")

    print("\nTesting single provider:")
    results = web_search("What is the weather in Tokyo?", providers=["duckduckgo"])
    print(f"Got {len(results)} results")
