import sys
# Logging before everything else
import logging
logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s: %(message)s',
    stream=sys.stdout
)

from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, Request, Response, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse, HTMLResponse
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.websockets import WebSocketDisconnect
from pydantic import BaseModel
from typing import Dict, Optional
import json
import time
import os
from dotenv import load_dotenv
import uuid
import zlib
import base64
import secrets
from social_crawler import get_prerendered_content
import asyncio
import aiofiles

from starlette.middleware.sessions import SessionMiddleware
from game import Game
from db import db

#==================================================================
# Models
#==================================================================
class CreateGameRequest(BaseModel):
    theme: Optional[str] = None
    language: str = "en"
    do_web_search: bool = False
    generator_id: Optional[str] = None

#==================================================================
# Security Configuration
#==================================================================

def get_session_secret_key() -> str:
    """
    Get or generate a secure session secret key.

    Returns:
        str: A secure session secret key

    Raises:
        ValueError: If no session secret is configured and fallback is disabled
    """
    session_secret = os.getenv("SESSION_SECRET_KEY")

    if session_secret:
        if len(session_secret) < 32:
            logging.warning(
                "SESSION_SECRET_KEY is shorter than recommended (32+ characters). "
                "Consider using a longer, more secure key."
            )
        return session_secret

    # Generate a secure fallback key
    fallback_key = secrets.token_urlsafe(32)
    logging.warning(
        "⚠️  SESSION_SECRET_KEY not found in environment variables!\n"
        "   Using a randomly generated key for this session.\n"
        "   This means user sessions will not persist across server restarts.\n"
        "   \n"
        "   To fix this:\n"
        "   1. Add SESSION_SECRET_KEY to your .env file\n"
        "   2. Use a secure random string (32+ characters)\n"
        "   3. Example: SESSION_SECRET_KEY=your_secure_random_string_here\n"
        "   \n"
        "   You can generate a secure key with:\n"
        "   python -c \"import secrets; print(secrets.token_urlsafe(32))\""
    )

    return fallback_key

#==================================================================
# FastAPI
#==================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logging.info("Loading environment variables from .env")
    load_dotenv()
    # Initialize database
    db.init_db()
    yield
    # Shutdown - ensure database uploads are completed
    logging.info("Shutting down database manager...")
    db.shutdown()

app = FastAPI(lifespan=lifespan)

# Session middleware with secure secret key
app.add_middleware(
    SessionMiddleware,
    secret_key=get_session_secret_key()
)

# Mount static files directory
app.mount("/static", StaticFiles(directory="static"), name="static")

# Create custom middleware for headers
class AddHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        # Add cache control headers
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response

# Add the middleware to your FastAPI app
app.add_middleware(AddHeadersMiddleware)

# Landing page
@app.get("/")
async def read_landing(request: Request):
    try:
        # Create new session
        request.session["game_session"] = str(uuid.uuid4())

        # Get Firebase configuration from environment variables
        firebase_config = {
            "apiKey": os.getenv("FIREBASE_API_KEY"),
            "authDomain": os.getenv("FIREBASE_AUTH_DOMAIN"),
            "projectId": os.getenv("FIREBASE_PROJECT_ID"),
            "storageBucket": os.getenv("FIREBASE_STORAGE_BUCKET"),
            "messagingSenderId": os.getenv("FIREBASE_MESSAGING_SENDER_ID"),
            "appId": os.getenv("FIREBASE_APP_ID"),
            "measurementId": os.getenv("FIREBASE_MEASUREMENT_ID")
        }

        # Check if there's a generator ID in the query params
        generator_id = request.query_params.get("generator")
        if generator_id:
            # Validate generator ID
            generator_data = db.get_generator(generator_id)
            if generator_data:
                # Store in session and redirect to game page
                request.session["generator_id"] = generator_id
                return RedirectResponse(url=f"/game?game_id={generator_id}")
            else:
                # If invalid generator ID, redirect to landing with error
                return RedirectResponse(url=f"/?error=invalid_generator")

        # Read and pre-render the HTML content using async file operations
        async with aiofiles.open("static/index.html", "r", encoding="utf-8") as f:
            html_content = await f.read()

        # Pre-render content for social media crawlers
        html_content = await get_prerendered_content(request, html_content)

        # Replace Firebase configuration placeholder
        html_content = html_content.replace(
            "{{ firebase_config | safe }}",
            json.dumps(firebase_config)
        )

        return HTMLResponse(content=html_content)
    except Exception as e:
        logging.error(f"Error reading landing page: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

# Game page
@app.get("/game")
async def read_game(request: Request):
    try:
        # Check if valid session exists
        if "game_session" not in request.session:
            # Create new session
            request.session["game_session"] = str(uuid.uuid4())

        # Check for generator_id/game_id in query parameters
        generator_id = request.query_params.get("generator_id")
        if not generator_id:
            generator_id = request.query_params.get("game_id")

        if generator_id:
            # Validate generator ID
            generator_data = db.get_generator(generator_id)
            if not generator_data:
                # If invalid generator ID, redirect to landing with error
                return RedirectResponse(url=f"/?error=invalid_generator")
            # Store valid generator ID in session
            request.session["generator_id"] = generator_id
        else:
            # Clear any existing generator ID if none provided
            request.session["generator_id"] = None

        # Read and pre-render the HTML content using async file operations
        async with aiofiles.open("static/game.html", "r", encoding="utf-8") as f:
            html_content = await f.read()

        # Pre-render content for social media crawlers
        html_content = await get_prerendered_content(request, html_content)
        return HTMLResponse(content=html_content)
    except Exception as e:
        logging.error(f"Error reading game page: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

# API endpoint for creating a new game
@app.post("/api/create_game")
async def create_game(request: CreateGameRequest, req: Request):
    try:
        if request.generator_id:
            # Check if generator exists
            generator_data = db.get_generator(request.generator_id)
            if not generator_data:
                return JSONResponse({
                    "error": f"Game ID not found: {request.generator_id}"
                }, status_code=404)

        # Store generator_id in session if provided
        req.session["generator_id"] = request.generator_id if request.generator_id else None

        # Set theme and language in session
        theme_desc = request.theme if request.theme else "fantasy"
        req.session["language"] = request.language
        req.session["do_web_search"] = request.do_web_search

        # Compress and store the theme description in session
        compressed = base64.b64encode(zlib.compress(theme_desc.encode())).decode()
        req.session["theme_desc"] = compressed

        return JSONResponse({
            "message": "Game configuration saved."
        })
    except Exception as e:
        logging.error(f"Error in create_game: {str(e)}")
        return JSONResponse({
            "error": str(e)
        }, status_code=500)

# Logout
@app.post("/logout")
async def logout(request: Request):
    request.session.clear()
    response = RedirectResponse(url="/", status_code=302)
    # Create new session immediately
    request.session["game_session"] = str(uuid.uuid4())
    return response

# Time profiler
class TimeProfiler:
    def __init__(self, name="Operation"):
        self.name = name

    def __enter__(self):
        self.start = time.time()
        return self

    def __exit__(self, *args):
        self.elapsed = time.time() - self.start
        logging.info(f"{self.name} took {self.elapsed:.2f} seconds")

# WebSocket endpoint for the game
@app.websocket("/ws/game")
async def websocket_endpoint(websocket: WebSocket):
    game_instance = None
    try:
        await websocket.accept()
        logging.info("New WebSocket connection established")

        session = websocket.session

        # Retrieve session variables
        generator_id = session.get("generator_id")
        language = session.get("language", "en")
        do_web_search = session.get("do_web_search", False)

        # Decompress theme description
        compressed_theme = session.get("theme_desc")
        if compressed_theme:
            theme_desc = zlib.decompress(base64.b64decode(compressed_theme)).decode()
        else:
            theme_desc = "fantasy"

        # Create a new Game instance
        rand_seed = int(time.time())

        # Create game instance using the factory method
        game_instance = await Game.create(
            seed=rand_seed,
            theme_desc=theme_desc,
            language=language,
            do_web_search=do_web_search,
            generator_id=generator_id
        )

        try:
            game_instance.connected_clients.add(websocket)

            if game_instance.error_message:
                logging.info(f"Sending error message: {game_instance.error_message}")
                await websocket.send_json({
                    'type': 'error',
                    'message': game_instance.error_message
                })

            initial_response = {
                'type': 'connection_established',
                'generator_id': game_instance.generator_id
            }
            await websocket.send_json(initial_response)

            while True:
                message = await websocket.receive_json()
                response = await game_instance.handle_message(message)

                if game_instance.generator_id and isinstance(response, dict):
                    response['generator_id'] = game_instance.generator_id

                await websocket.send_json(response)

        except WebSocketDisconnect:
            logging.info("WebSocket client disconnected normally")
        except ConnectionResetError:
            logging.info("WebSocket connection reset by client")
        except Exception as e:
            logging.exception(f"Game loop error: {e}")
            # Try to send error message if connection is still open
            try:
                await websocket.send_json({
                    'type': 'error',
                    'message': 'Game error occurred'
                })
            except (WebSocketDisconnect, ConnectionResetError, RuntimeError):
                logging.debug("Could not send error message - connection already closed")
    except WebSocketDisconnect:
        logging.info("WebSocket disconnected during initialization")
    except Exception as e:
        logging.exception(f"WebSocket connection error: {e}")
        # Send error message to client if possible
        try:
            await websocket.send_json({
                'type': 'error',
                'message': f'Failed to initialize game: {str(e)}'
            })
        except (WebSocketDisconnect, ConnectionResetError, RuntimeError) as send_error:
            logging.debug(f"Could not send initialization error message: {send_error}")
    finally:
        if game_instance and hasattr(game_instance, 'connected_clients'):
            try:
                game_instance.connected_clients.discard(websocket)  # Use discard instead of remove to avoid KeyError
            except Exception as cleanup_error:
                logging.debug(f"Error during WebSocket cleanup: {cleanup_error}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
