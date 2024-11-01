from fastapi import FastAPI, WebSocket, Request, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel
from typing import Dict, List, Optional, Union
import json
import time
import logging
import sys
import os
from dotenv import load_dotenv
import uuid

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

@app.websocket("/ws/game")
async def websocket_endpoint(websocket: WebSocket):
    # Get session from websocket cookies
    session = websocket.cookies.get("session")
    if not session:
        await websocket.close()
        return

    # Create the game instance with a random seed (use fixed seed for debugging)
    rand_seed = int(time.time())
    #rand_seed = 699
    game_instance = Game(seed=rand_seed, game_desc="fantasy")

    logging.info("New WebSocket connection attempt")
    await websocket.accept()
    logging.info("WebSocket connection accepted")

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
