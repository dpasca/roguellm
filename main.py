from fastapi import FastAPI, WebSocket, Request, Response, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel
from typing import Dict, Optional
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
from db import db

#==================================================================
# Logging
#==================================================================
logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s: %(message)s',
    stream=sys.stdout
)

#==================================================================
# Models
#==================================================================
class CreateGameRequest(BaseModel):
    theme: Optional[str] = None
    language: str = "en"
    do_web_search: bool = False
    generator_id: Optional[str] = None

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

# Add the middleware to your FastAPI app
app.add_middleware(AddHeadersMiddleware)

# Global dictionary to store active games
games: Dict[str, Game] = {}

@app.on_event("startup")
async def startup_event():
    # Initialize database
    db.init_db()

# Helper function to create a game instance
def create_game_instance(seed: int, theme_desc: str, language: str, do_web_search: bool, generator_id: Optional[str] = None) -> Game:
    game_instance = Game(
        seed=seed,
        theme_desc=theme_desc,
        do_web_search=do_web_search,
        language=language,
        generator_id=generator_id
    )
    return game_instance

# Adjusted landing page
@app.get("/")
async def read_landing(request: Request):
    # Create new session
    request.session["game_session"] = str(uuid.uuid4())

    # Check if there's a generator ID in the query params
    generator_id = request.query_params.get("generator")
    if generator_id:
        request.session["generator_id"] = generator_id

    return FileResponse("static/index.html")

# Game page
@app.get("/game.html")
async def read_game(request: Request):
    # Check if valid session exists
    if "game_session" not in request.session:
        return RedirectResponse(url="/")

    # Check for generator_id in query parameters
    generator_id = request.query_params.get("generator_id")
    if generator_id:
        # Use generator_id as game_id
        request.session["game_id"] = generator_id
        request.session["generator_id"] = generator_id
    else:
        # Generate a new unique game_id
        game_id = str(uuid.uuid4())[:8]
        request.session["game_id"] = game_id

    return FileResponse("static/game.html")

# API endpoint for creating a new game
@app.post("/api/create_game")
async def create_game(request: CreateGameRequest, req: Request):
    try:
        # Use generator_id as game_id if provided
        if request.generator_id:
            game_id = request.generator_id
            generator_id = request.generator_id
            req.session["generator_id"] = generator_id
        else:
            # Generate a new unique game_id
            game_id = str(uuid.uuid4())[:8]
            generator_id = None

        req.session["game_id"] = game_id

        # Create the Game instance
        rand_seed = int(time.time())

        theme_desc = request.theme if request.theme else "fantasy"
        language = request.language
        do_web_search = request.do_web_search

        # Compress theme description if necessary
        if not generator_id:
            compressed = base64.b64encode(zlib.compress(theme_desc.encode())).decode()
            req.session["theme_desc"] = compressed
            req.session["do_web_search"] = do_web_search
            req.session["language"] = language
        else:
            req.session["generator_id"] = generator_id

        game_instance = create_game_instance(
            seed=rand_seed,
            theme_desc=theme_desc,
            language=language,
            do_web_search=do_web_search,
            generator_id=generator_id
        )

        # Store game instance in games dictionary
        games[game_id] = game_instance

        # If a new generator was created, get the consistent generator_id from the game instance
        if not generator_id:
            generator_id = game_instance.generator_id
            req.session["generator_id"] = generator_id
            # Update game_id to use the new generator_id
            game_id = generator_id
            req.session["game_id"] = game_id
            # Update the games dictionary
            games[game_id] = game_instance

        return JSONResponse({
            "game_id": game_id
        })
    except Exception as e:
        logging.error(f"Error creating game: {str(e)}")
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
    await websocket.accept()
    logging.info("New WebSocket connection established")

    session = websocket.session

    # Get game_id from session
    game_id = session.get("game_id")
    if not game_id:
        await websocket.close()
        return

    # Retrieve or create the game instance
    if game_id in games:
        game_instance = games[game_id]
    else:
        # Recreate game instance if not found in games
        rand_seed = int(time.time())
        generator_id = session.get("generator_id")
        language = session.get("language", "en")
        do_web_search = session.get("do_web_search", False)

        if generator_id:
            theme_desc = ""
        else:
            compressed_theme = session.get("theme_desc", "fantasy")
            if compressed_theme != "fantasy":
                theme_desc = zlib.decompress(base64.b64decode(compressed_theme)).decode()
            else:
                theme_desc = "fantasy"

        game_instance = create_game_instance(
            seed=rand_seed,
            theme_desc=theme_desc,
            language=language,
            do_web_search=do_web_search,
            generator_id=generator_id
        )
        games[game_id] = game_instance

    try:
        # Initialize the game if not already initialized
        if not hasattr(game_instance, 'state'):
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
        # Add generator_id to the response if available
        if game_instance.generator_id:
            initial_state['generator_id'] = game_instance.generator_id
        await websocket.send_json(initial_state)

        LOG_IN_LOOP = False

        while True:
            if LOG_IN_LOOP:
                logging.info("Waiting for message...")

            message = await websocket.receive_json()

            if LOG_IN_LOOP:
                logging.info(f"Received message: {message}")

            # Handle restart with generator
            if message.get('action') == 'restart':
                rand_seed = int(time.time())
                generator_id = game_instance.generator_id
                language = game_instance.language
                do_web_search = False  # No need to perform web search on restart

                if generator_id:
                    theme_desc = ""
                else:
                    compressed_theme = session.get("theme_desc", "fantasy")
                    if compressed_theme != "fantasy":
                        theme_desc = zlib.decompress(base64.b64decode(compressed_theme)).decode()
                    else:
                        theme_desc = "fantasy"

                game_instance = create_game_instance(
                    seed=rand_seed,
                    theme_desc=theme_desc,
                    language=language,
                    do_web_search=do_web_search,
                    generator_id=generator_id
                )
                games[game_id] = game_instance
                await game_instance.initialize_game()

            response = await game_instance.handle_message(message)

            # Add generator_id to responses if available
            if game_instance.generator_id and isinstance(response, dict):
                response['generator_id'] = game_instance.generator_id

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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
