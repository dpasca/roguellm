from fastapi import FastAPI, WebSocket, Request, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel
from typing import Dict, List, Optional, Union
import json
import time
import logging
import sys
import os
from dotenv import load_dotenv
import uuid
import zlib
import base64

from starlette.middleware.sessions import SessionMiddleware
from game import Game

#==================================================================
# Logging
#==================================================================
logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s: %(message)s',
    stream=sys.stdout
)

#==================================================================
# FastAPI
#==================================================================
app = FastAPI()

# Load the appropriate .env file
load_dotenv(".env.dev" if os.getenv("ENVIRONMENT") == "development" else ".env.prod")

# Session middleware
app.add_middleware(
    SessionMiddleware,
    secret_key=os.getenv("SESSION_SECRET_KEY")
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

# Add the middleware to your FastAPI app (place this after app = FastAPI())
app.add_middleware(AddHeadersMiddleware)

# Landing page - Updated to handle POST requests for theme selection
@app.post("/")
async def select_theme(request: Request):
    form = await request.form()
    theme = form.get("theme")
    if theme == "fantasy":
        game_desc = "fantasy"
    elif theme == "custom":
        game_desc = form.get("description", "custom")
    else:
        game_desc = "fantasy"  # default fallback

    request.session["game_desc"] = game_desc
    return RedirectResponse(url="/game", status_code=303)

@app.get("/")
async def read_landing(request: Request):
    # Create new session
    request.session["game_session"] = str(uuid.uuid4())
    return FileResponse("static/index.html")

# Game page
@app.get("/game")
async def read_game(request: Request):
    # Check if valid session exists
    if "game_session" not in request.session:
        return RedirectResponse(url="/")
    return FileResponse("static/game.html")

# Logout
@app.post("/logout")
async def logout(request: Request):
    request.session.clear()
    response = RedirectResponse(url="/", status_code=302)
    # Create new session immediately
    request.session["game_session"] = str(uuid.uuid4())
    return response
# Set the game theme / description
@app.post("/set-theme")
async def set_theme(request: Request):
    data = await request.json()
    theme = data.get('theme', 'fantasy')
    lang = data.get('language', 'en')
    do_web_search = data.get('do_web_search', False)
    # Compress the theme string
    compressed = base64.b64encode(zlib.compress(theme.encode())).decode()
    request.session["theme_desc"] = compressed
    request.session["language"] = lang
    request.session["do_web_search"] = do_web_search
    return JSONResponse({"status": "success"})

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
    # Accept the connection once at the beginning
    await websocket.accept()
    logging.info("New WebSocket connection established")

    # Get theme from session (set by /set-theme)
    session = websocket.session
    compressed_theme = session.get("theme_desc", "fantasy")
    # If it's the default "fantasy" string, no need to decompress
    if compressed_theme == "fantasy":
        theme_desc = compressed_theme
    else:
        # Decompress the theme
        theme_desc = zlib.decompress(base64.b64decode(compressed_theme)).decode()

    # Get do_web_search from session (set by /set-theme)
    do_web_search = session.get("do_web_search", False)
    logging.info(f"Do web search: {do_web_search}")

    # Get language from session (set by /set-theme)
    lang = session.get("language", "en")
    logging.info(f"Language: {lang}")

    # Create the game instance with a random seed and the theme description
    rand_seed = int(time.time())
    with TimeProfiler("Game instance creation"):
       game_instance = Game(
           seed=rand_seed,
           theme_desc=theme_desc,
           do_web_search=do_web_search,
           language=lang
       )

    try:
        # Initialize the game
        await game_instance.initialize_game()

        game_instance.connected_clients.add(websocket)

        if game_instance.error_message:
            logging.info(f"Sending error message: {game_instance.error_message}")
            await websocket.send_json({
                'type': 'error',
                'message': game_instance.error_message
            })

        logging.info("Sending initial state")
        initial_state = await game_instance.handle_message({'action': 'initialize'})
        logging.info(f"Initial state: {initial_state}")
        await websocket.send_json(initial_state)

        LOG_IN_LOOP = False

        while True:
            if LOG_IN_LOOP:
                logging.info("Waiting for message...")

            message = await websocket.receive_json()

            if LOG_IN_LOOP:
                logging.info(f"Received message: {message}")

            response = await game_instance.handle_message(message)

            if LOG_IN_LOOP:
                response_str = str(response)
                if len(response_str) > 40:
                    logging.info(f"Response: {response_str[:40]} [...]")
                else:
                    logging.info(f"Response: {response_str}")

            await websocket.send_json(response)
    except Exception as e:
        logging.exception("Exception in WebSocket endpoint")
    finally:
        game_instance.connected_clients.remove(websocket)
