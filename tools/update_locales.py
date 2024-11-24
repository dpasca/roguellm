import json
import os
from openai import OpenAI
from dotenv import load_dotenv
from typing import Dict
import logging
import re
import argparse

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('translation_update.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

def clean_json_response(response: str) -> str:
    """
    Clean potential markdown formatting from the JSON response.
    """
    # Remove potential markdown code block formatting
    json_pattern = r"```(?:json)?\s*([\s\S]*?)```"
    match = re.search(json_pattern, response)
    if match:
        response = match.group(1)
    return response.strip()

def generate_translation(translations: Dict, target_lang: str) -> Dict:
    """
    Generate translations for a specific language using OpenAI's API.
    
    Args:
        translations: Dictionary containing the English translations
        target_lang: Target language code (e.g., 'it', 'ja')
    
    Returns:
        Dictionary containing the translated content
    """
    client = OpenAI()

    system_prompt = """You are a professional translator for a technology and software development company.
Your task is to translate website content accurately while maintaining technical accuracy and a professional tone.
Return ONLY the translated JSON without any markdown formatting or explanation."""

    user_prompt = f"""Translate the following website content from English to {target_lang}.
Maintain technical terms appropriately and ensure all JSON formatting remains intact.
Content to translate:

{json.dumps(translations, ensure_ascii=False, indent=2)}"""

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.3,  # Lower temperature for more consistent translations
        )

        # Get the response content and clean it
        translation_text = response.choices[0].message.content
        cleaned_json_text = clean_json_response(translation_text)

        # Parse the cleaned JSON text
        try:
            return json.loads(cleaned_json_text)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse JSON response: {e}")
            logger.debug(f"Problematic JSON content: {cleaned_json_text}")
            raise

    except Exception as e:
        logger.error(f"Translation generation failed: {e}")
        raise

def main():
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Generate translations for multiple languages')
    parser.add_argument('base_path', help='Base path where en.json is located')
    parser.add_argument('target_langs', help='Comma-separated list of target languages (e.g., it,ja)')
    args = parser.parse_args()

    # Load environment variables
    load_dotenv()

    if not os.getenv("OPENAI_API_KEY"):
        logger.error("OPENAI_API_KEY not found in environment variables")
        raise ValueError("OPENAI_API_KEY not found in environment variables")

    # Load English translations
    en_file_path = os.path.join(args.base_path, "en.json")
    try:
        with open(en_file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            logger.info("Successfully loaded English translations")
    except Exception as e:
        logger.error(f"Failed to load English translations: {e}")
        raise

    # Parse target languages from command line argument
    target_languages = args.target_langs.split(',')

    # Generate translations for each target language
    for lang in target_languages:
        try:
            logger.info(f"Starting translation for {lang}")
            translations = generate_translation(data, lang)

            # Save translations to file
            output_path = os.path.join(args.base_path, f"{lang}.json")
            with open(output_path, "w", encoding='utf-8') as f:
                json.dump(translations, f, ensure_ascii=False, indent=2)
            logger.info(f"Successfully generated and saved translations for {lang}")

        except Exception as e:
            logger.error(f"Failed to process translations for {lang}: {e}")

if __name__ == "__main__":
    main()