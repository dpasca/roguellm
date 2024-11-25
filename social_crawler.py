import re
from typing import Dict, List
from fastapi import Request
from bs4 import BeautifulSoup
import json
import os

SOCIAL_MEDIA_AGENTS = [
    'facebookexternalhit',
    'twitterbot',
    'linkedinbot',
    'whatsapp',
    'telegrambot',
    'slackbot',
    'discordbot'
]

def is_social_crawler(request: Request) -> bool:
    user_agent = request.headers.get('user-agent', '').lower()
    return any(bot in user_agent for bot in SOCIAL_MEDIA_AGENTS)

def load_translations(language: str = 'en') -> Dict:
    try:
        with open(f'static/translations/{language}.json', 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        # Fallback to English if translation not found
        with open('static/translations/en.json', 'r', encoding='utf-8') as f:
            return json.load(f)

def prerender_template(html_content: str, translations: Dict) -> str:
    """Replace template variables with actual content for social media crawlers"""
    soup = BeautifulSoup(html_content, 'html.parser')
    
    # Find all elements with {{ t('key') }} pattern
    pattern = re.compile(r"{{[\s]*t\('([^']+)'\)[\s]*}}")
    
    # Process text nodes
    for element in soup.find_all(text=True):
        if pattern.search(str(element)):
            new_text = pattern.sub(lambda m: translations.get(m.group(1), m.group(0)), str(element))
            element.replace_with(new_text)
    
    return str(soup)

async def get_prerendered_content(request: Request, html_content: str) -> str:
    """Get pre-rendered content for social media crawlers"""
    if not is_social_crawler(request):
        return html_content
        
    # Get language from query params or default to English
    language = request.query_params.get('lang', 'en')
    translations = load_translations(language)
    
    return prerender_template(html_content, translations)
