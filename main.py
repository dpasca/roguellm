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

    # Check for generator_id in query parameters and store in session
    generator_id = request.query_params.get("generator_id")
    request.session["generator_id"] = generator_id if generator_id else None

    return FileResponse("static/game.html")

# API endpoint for creating a new game
@app.post("/api/create_game")
async def create_game(request: CreateGameRequest, req: Request):
    try:
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
    game_instance = create_game_instance(
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
        # Send initial state with generator ID
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
    except Exception as e:
        logging.exception("Exception in WebSocket endpoint")
    finally:
        game_instance.connected_clients.remove(websocket)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
