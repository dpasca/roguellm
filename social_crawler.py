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
    except (FileNotFoundError, json.JSONDecodeError, UnicodeDecodeError) as e:
        # Fallback to English if translation not found or invalid
        import logging
        logging.warning(f"Could not load translations for language '{language}': {e}. Falling back to English.")
        try:
            with open('static/translations/en.json', 'r', encoding='utf-8') as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError, UnicodeDecodeError) as fallback_error:
            logging.error(f"Could not load English fallback translations: {fallback_error}")
            return {}  # Return empty dict as last resort

def prerender_template(html_content: str, translations: Dict, is_crawler: bool = False) -> str:
    """Replace template variables with actual content"""
    soup = BeautifulSoup(html_content, 'html.parser')

    # Find all elements with {{ t('key') }} or {{ variable }} pattern
    t_pattern = re.compile(r"{{\s*t\('([^']+)'(?:\s*,\s*([^}]+))?\)\s*}}")
    var_pattern = re.compile(r"{{\s*([a-zA-Z][a-zA-Z0-9._]*)\s*}}")

    # Default values for common variables
    default_values = {
        'lang.name': 'English',
        'errorMessage': '',
        'gameTitle': 'RogueLLM',
        'config.links.author.text': 'Davide Aversa',
        'config.links.author.url': 'https://github.com/DavideAversa'
    }

    # Process text nodes
    for element in soup.find_all(text=True):
        text = str(element)
        modified = False

        # Handle t() translations
        if t_pattern.search(text):
            text = t_pattern.sub(lambda m: process_translation(m, translations), text)
            modified = True

        # Handle simple variables
        if var_pattern.search(text):
            text = var_pattern.sub(lambda m: default_values.get(m.group(1), m.group(0)), text)
            modified = True

        if modified:
            element.replace_with(text)

    # If it's a social media crawler, keep everything pre-rendered
    if is_crawler:
        # Also add v-cloak to prevent flash of uncompiled content
        app_div = soup.find(id='app')
        if app_div:
            app_div['v-cloak'] = ''
        return str(soup)

    # For regular users, only pre-render the <title> and <meta> tags
    if not is_crawler:
        # Reset all other elements back to their template form
        for element in soup.find_all(text=True):
            if element.parent and element.parent.name not in ['title', 'meta']:
                continue
            text = str(element)
            modified = False

            # Handle t() translations
            if t_pattern.search(text):
                text = t_pattern.sub(lambda m: process_translation(m, translations), text)
                modified = True

            # Handle simple variables
            if var_pattern.search(text):
                text = var_pattern.sub(lambda m: default_values.get(m.group(1), m.group(0)), text)
                modified = True

            if modified:
                element.replace_with(text)

    return str(soup)

def process_translation(match: re.Match, translations: Dict) -> str:
    """Process a single translation match"""
    key = match.group(1)
    params_str = match.group(2)

    if key not in translations:
        return match.group(0)  # Return original if key not found

    text = translations[key]

    # Handle parameters if they exist
    if params_str:
        try:
            # Convert the params string to a dict
            # First, wrap the params in brackets to make it valid JSON
            params_json = "{" + params_str.strip() + "}"
            params = json.loads(params_json)

            # Replace placeholders in the text
            for param_key, param_value in params.items():
                placeholder = "${" + param_key + "}"
                text = text.replace(placeholder, str(param_value))
        except (json.JSONDecodeError, KeyError, AttributeError) as e:
            # If parameter processing fails, return text as is
            import logging
            logging.debug(f"Could not process translation parameters for '{key}': {e}")
            pass

    return text

async def get_prerendered_content(request: Request, html_content: str) -> str:
    """Get pre-rendered content, with special handling for social media crawlers"""
    # Get language from query params or default to English
    language = request.query_params.get('lang', 'en')
    translations = load_translations(language)

    is_crawler = is_social_crawler(request)
    return prerender_template(html_content, translations, is_crawler)
