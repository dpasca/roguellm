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
from texture_generator import TextureGenerator

#==================================================================
# Game Session Management
#==================================================================
class GameSessionManager:
    """Manages in-memory game sessions."""

    def __init__(self):
        self.sessions: Dict[str, dict] = {}  # Changed to store session data directly

    def create_session(self, game_instance: Game) -> str:
        """Create a new game session and return session ID."""
        session_id = str(uuid.uuid4())
        self.sessions[session_id] = {
            'created_at': time.time(),
            'last_accessed': time.time(),
            'game_instance': game_instance,
            'generator_id': game_instance.state_manager.generator_id if game_instance.state_manager else None,
            'status': 'ready'
        }
        logging.info(f"Created new game session: {session_id}")
        return session_id

    def get_session(self, session_id: str) -> Optional[Game]:
        """Get a game session by ID."""
        if session_id in self.sessions:
            session_data = self.sessions[session_id]
            session_data['last_accessed'] = time.time()

            # Handle both new and old session structures
            if isinstance(session_data, dict) and 'game_instance' in session_data:
                return session_data['game_instance']
            else:
                # Old structure - session_data is the game instance directly
                return session_data
        return None

    def remove_session(self, session_id: str):
        """Remove a game session."""
        if session_id in self.sessions:
            del self.sessions[session_id]
            logging.info(f"Removed game session: {session_id}")

    def cleanup_expired_sessions(self, max_age_hours: int = 24):
        """Remove sessions older than max_age_hours."""
        current_time = time.time()
        expired_sessions = []

        for session_id, session_data in self.sessions.items():
            if current_time - session_data['last_accessed'] > max_age_hours * 3600:
                expired_sessions.append(session_id)

        for session_id in expired_sessions:
            self.remove_session(session_id)

        if expired_sessions:
            logging.info(f"Cleaned up {len(expired_sessions)} expired sessions")

    def get_session_count(self) -> int:
        """Get the number of active sessions."""
        return len(self.sessions)

# Global session manager
game_session_manager = GameSessionManager()

#==================================================================
# Models
#==================================================================
class CreateGameRequest(BaseModel):
    theme: Optional[str] = None
    language: str = "en"
    do_web_search: bool = False
    generator_id: Optional[str] = None

class CreateGameSessionRequest(BaseModel):
    generator_id: Optional[str] = None
    theme: Optional[str] = None
    language: str = "en"
    do_web_search: bool = False

class GameCreationRequest(BaseModel):
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

    # Start session cleanup task
    async def cleanup_task():
        while True:
            await asyncio.sleep(3600)  # Run every hour
            game_session_manager.cleanup_expired_sessions()

    cleanup_task_handle = asyncio.create_task(cleanup_task())

    yield

    # Shutdown - ensure database uploads are completed
    logging.info("Shutting down database manager...")
    cleanup_task_handle.cancel()
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

# Game page - handles both generator sharing and direct session access
@app.get("/game")
async def read_game(request: Request):
    try:
        # Check if valid session exists
        if "game_session" not in request.session:
            # Create new session
            request.session["game_session"] = str(uuid.uuid4())

        # Check for generator_id/game_id in query parameters (for sharing)
        generator_id = request.query_params.get("generator_id")
        if not generator_id:
            generator_id = request.query_params.get("game_id")

        if generator_id:
            # Validate generator ID
            generator_data = db.get_generator(generator_id)
            if not generator_data:
                # If invalid generator ID, redirect to landing with error
                return RedirectResponse(url=f"/?error=invalid_generator")

            # Check if user already has a session for this generator
            existing_session_id = request.session.get(f"game_session_{generator_id}")
            if existing_session_id and game_session_manager.get_session(existing_session_id):
                # Redirect to existing session
                return RedirectResponse(url=f"/game/{existing_session_id}")

            # Create new game session for this generator
            try:
                game_instance = await Game.create(
                    seed=int(time.time()),
                    theme_desc=generator_data['theme_desc'],
                    language=generator_data['language'],
                    do_web_search=False,  # Don't re-do web search for shared generators
                    generator_id=generator_id
                )

                session_id = game_session_manager.create_session(game_instance)
                request.session[f"game_session_{generator_id}"] = session_id

                # Redirect to the new session
                return RedirectResponse(url=f"/game/{session_id}")

            except Exception as e:
                logging.error(f"Error creating game session for generator {generator_id}: {e}")
                return RedirectResponse(url=f"/?error=failed_to_create_game")

        # No generator ID provided - redirect to landing page
        return RedirectResponse(url="/")

    except Exception as e:
        logging.error(f"Error reading game page: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

# Game session page - serves the actual game for a specific session
@app.get("/game/{session_id}")
async def read_game_session(session_id: str, request: Request):
    try:
        # Validate session exists (check directly in sessions dict)
        if session_id not in game_session_manager.sessions:
            # Session not found, redirect to landing
            return RedirectResponse(url="/?error=session_not_found")

        # Read and serve the game HTML
        async with aiofiles.open("static/game.html", "r", encoding="utf-8") as f:
            html_content = await f.read()

        # Pre-render content for social media crawlers
        html_content = await get_prerendered_content(request, html_content)
        return HTMLResponse(content=html_content)

    except Exception as e:
        logging.error(f"Error reading game session page: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

# API endpoint for creating a new game session (replaces the old create_game)
@app.post("/api/create_game_session")
async def create_game_session(request: GameCreationRequest):
    """Create a new game session and return session ID immediately"""
    session_id = str(uuid.uuid4())

    # Store the session with initial state in the new format
    game_session_manager.sessions[session_id] = {
        'created_at': time.time(),
        'last_accessed': time.time(),
        'game_instance': None,  # Will be set when game is created
        'creation_request': request,
        'status': 'creating',  # creating, ready, error
        'generator_id': request.generator_id
    }

    logging.info(f"Created new game session: {session_id}")

    return {
        "session_id": session_id,
        "status": "creating"
    }

# Legacy API endpoint for backward compatibility
@app.post("/api/create_game")
async def create_game(request: CreateGameRequest, req: Request):
    """Legacy endpoint - redirects to new session-based flow."""
    try:
        if request.generator_id:
            # Check if generator exists
            generator_data = db.get_generator(request.generator_id)
            if not generator_data:
                return JSONResponse({
                    "error": f"Game ID not found: {request.generator_id}"
                }, status_code=404)

        # Store configuration in session for the new flow
        req.session["generator_id"] = request.generator_id if request.generator_id else None
        req.session["language"] = request.language
        req.session["do_web_search"] = request.do_web_search

        # Set theme and compress it
        theme_desc = request.theme if request.theme else "fantasy"
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

# API endpoint to clear game instance cache (for testing)
@app.post("/api/admin/clear_cache")
async def clear_game_instance_cache(generator_id: Optional[str] = None):
    """Clear cached game instances for testing purposes."""
    try:
        db.clear_game_instance_cache(generator_id)
        message = f"Cleared game instance cache for generator {generator_id}" if generator_id else "Cleared all game instance cache"
        logging.info(message)
        return JSONResponse({"message": message})
    except Exception as e:
        logging.error(f"Error clearing cache: {str(e)}")
        return JSONResponse({"error": str(e)}, status_code=500)

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

# WebSocket endpoint for the game - now works with sessions
@app.websocket("/ws/game/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()

    try:
        # Check if session exists
        if session_id not in game_session_manager.sessions:
            await websocket.send_json({
                "type": "error",
                "message": "Session not found"
            })
            return

        session = game_session_manager.sessions[session_id]

        # If game is not created yet, create it now
        if session['status'] == 'creating':
            await websocket.send_json({
                "type": "status",
                "message": "Creating game world...",
                "status": "creating"
            })

            try:
                request = session['creation_request']

                if request.generator_id:
                    # Check if generator exists
                    generator_data = db.get_generator(request.generator_id)
                    if not generator_data:
                        await websocket.send_json({
                            "type": "error",
                            "message": f"Game ID not found: {request.generator_id}"
                        })
                        return

                    # Use generator data
                    theme_desc = generator_data['theme_desc']
                    language = generator_data['language']
                    do_web_search = False  # Don't re-do web search for existing generators
                else:
                    # Use provided parameters
                    theme_desc = request.theme if request.theme else "fantasy"
                    language = request.language
                    do_web_search = request.do_web_search

                await websocket.send_json({
                    "type": "status",
                    "message": "Generating game content...",
                    "status": "creating"
                })

                # Create new game instance with timeout
                try:
                    game_instance = await asyncio.wait_for(
                        Game.create(
                            seed=int(time.time()),
                            theme_desc=theme_desc,
                            language=language,
                            do_web_search=do_web_search,
                            generator_id=request.generator_id
                        ),
                        timeout=60.0  # 1 minute timeout
                    )
                except asyncio.TimeoutError:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Game creation is taking longer than expected. Please try again with a simpler theme or use an existing generator."
                    })
                    return

                # Update session with created game
                session['game_instance'] = game_instance
                session['status'] = 'ready'
                session['last_accessed'] = time.time()
                if game_instance.state_manager:
                    session['generator_id'] = game_instance.state_manager.generator_id

                await websocket.send_json({
                    "type": "status",
                    "message": "Game ready!",
                    "status": "ready"
                })

            except Exception as e:
                logging.error(f"Error creating game for session {session_id}: {str(e)}")
                session['status'] = 'error'
                await websocket.send_json({
                    "type": "error",
                    "message": f"Failed to create game: {str(e)}"
                })
                return

        # Get the game instance
        game_instance = session['game_instance']
        if not game_instance:
            await websocket.send_json({
                "type": "error",
                "message": "Game not ready"
            })
            return

        # Handle the WebSocket connection with the game instance
        try:
            game_instance.add_client(websocket)

            # Check for error message through state manager
            if game_instance.state_manager and game_instance.state_manager.error_message:
                logging.info(f"Sending error message: {game_instance.state_manager.error_message}")
                await websocket.send_json({
                    'type': 'error',
                    'message': game_instance.state_manager.error_message
                })

            initial_response = {
                'type': 'connection_established',
                'generator_id': game_instance.state_manager.generator_id if game_instance.state_manager else None
            }
            await websocket.send_json(initial_response)

            while True:
                message = await websocket.receive_json()
                response = await game_instance.handle_message(message)

                # Add generator_id to response if available
                if game_instance.state_manager and game_instance.state_manager.generator_id and isinstance(response, dict):
                    response['generator_id'] = game_instance.state_manager.generator_id

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
        finally:
            if game_instance:
                try:
                    game_instance.remove_client(websocket)
                except Exception as cleanup_error:
                    logging.debug(f"Error during WebSocket cleanup: {cleanup_error}")

    except WebSocketDisconnect:
        logging.info(f"WebSocket disconnected for session: {session_id}")
    except Exception as e:
        logging.error(f"WebSocket error for session {session_id}: {str(e)}")
        try:
            await websocket.send_json({
                "type": "error",
                "message": str(e)
            })
        except:
            pass

# Legacy WebSocket endpoint for backward compatibility
@app.websocket("/ws/game")
async def legacy_websocket_endpoint(websocket: WebSocket):
    """Legacy WebSocket endpoint - creates session on-the-fly for backward compatibility."""
    game_instance = None
    try:
        await websocket.accept()
        logging.info("New WebSocket connection established (legacy)")

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

        # Create session for this game
        session_id = game_session_manager.create_session(game_instance)
        logging.info(f"Created legacy session: {session_id}")

        try:
            game_instance.add_client(websocket)

            # Check for error message through state manager
            if game_instance.state_manager and game_instance.state_manager.error_message:
                logging.info(f"Sending error message: {game_instance.state_manager.error_message}")
                await websocket.send_json({
                    'type': 'error',
                    'message': game_instance.state_manager.error_message
                })

            initial_response = {
                'type': 'connection_established',
                'generator_id': game_instance.state_manager.generator_id if game_instance.state_manager else None
            }
            await websocket.send_json(initial_response)

            while True:
                message = await websocket.receive_json()
                response = await game_instance.handle_message(message)

                # Add generator_id to response if available
                if game_instance.state_manager and game_instance.state_manager.generator_id and isinstance(response, dict):
                    response['generator_id'] = game_instance.state_manager.generator_id

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
        if game_instance:
            try:
                game_instance.remove_client(websocket)
            except Exception as cleanup_error:
                logging.debug(f"Error during WebSocket cleanup: {cleanup_error}")

# API endpoint to get session info
@app.get("/api/session/{session_id}/info")
async def get_session_info(session_id: str):
    """Get information about a game session."""
    if session_id not in game_session_manager.sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session_data = game_session_manager.sessions[session_id]

    # Handle both new and old session structures
    if isinstance(session_data, dict) and 'game_instance' in session_data:
        # New structure
        game_instance = session_data['game_instance']
        return JSONResponse({
            "session_id": session_id,
            "generator_id": session_data.get('generator_id'),
            "created_at": session_data.get('created_at'),
            "last_accessed": session_data.get('last_accessed'),
            "status": session_data.get('status'),
            "game_title": game_instance.get_game_title() if game_instance else None
        })
    else:
        # Old structure - session_data is the game instance directly
        game_instance = session_data
        return JSONResponse({
            "session_id": session_id,
            "generator_id": game_instance.state_manager.generator_id if game_instance.state_manager else None,
            "created_at": None,  # Not available in old structure
            "last_accessed": None,  # Not available in old structure
            "status": "ready",  # Assume ready for old structure
            "game_title": game_instance.get_game_title() if game_instance else None
        })

# Initialize texture generator
texture_generator = TextureGenerator()

# Texture atlas API endpoints
@app.post("/api/textures/generate")
async def generate_texture_atlas(request: Request):
    """Generate a texture atlas for a generator"""
    try:
        data = await request.json()
        generator_id = data.get('generator_id')
        theme_description = data.get('theme_description', '')
        cell_types = data.get('cell_types', [])
        atlas_size = data.get('atlas_size', 1024)
        grid_size = data.get('grid_size', 4)
        use_ai = data.get('use_ai', False)

        if not generator_id or not cell_types:
            raise HTTPException(status_code=400, detail="generator_id and cell_types are required")

        atlas = await texture_generator.generate_texture_atlas(
            generator_id=generator_id,
            theme_description=theme_description,
            cell_types=cell_types,
            atlas_size=atlas_size,
            grid_size=grid_size,
            use_ai=use_ai
        )

        return JSONResponse({
            "atlas_id": atlas.id,
            "generator_id": atlas.generator_id,
            "atlas_size": atlas.atlas_size,
            "grid_size": atlas.grid_size,
            "cells": {k: v.model_dump() for k, v in atlas.cells.items()},
            "local_path": atlas.local_path
        })

    except Exception as e:
        logging.error(f"Failed to generate texture atlas: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/textures/{atlas_id}")
async def get_texture_atlas_info(atlas_id: str):
    """Get texture atlas metadata"""
    try:
        atlas = await texture_generator.get_atlas_by_id(atlas_id)
        if not atlas:
            raise HTTPException(status_code=404, detail="Atlas not found")

        return JSONResponse({
            "atlas_id": atlas.id,
            "generator_id": atlas.generator_id,
            "atlas_size": atlas.atlas_size,
            "grid_size": atlas.grid_size,
            "cells": {k: v.model_dump() for k, v in atlas.cells.items()},
            "local_path": atlas.local_path,
            "created_at": atlas.created_at
        })

    except Exception as e:
        logging.error(f"Failed to get texture atlas info: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/textures/{atlas_id}/image")
async def get_texture_atlas_image(atlas_id: str):
    """Get texture atlas image file"""
    try:
        # Get atlas info to find generator_id
        atlas = await texture_generator.get_atlas_by_id(atlas_id)
        if not atlas:
            raise HTTPException(status_code=404, detail="Atlas not found")

        # Get image data
        image_data = await texture_generator.get_atlas_image_data(atlas.generator_id, atlas_id)
        if not image_data:
            raise HTTPException(status_code=404, detail="Atlas image not found")

        return Response(
            content=image_data,
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=3600"}  # Cache for 1 hour
        )

    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Failed to get texture atlas image: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# API endpoint to get server stats
@app.get("/api/stats")
async def get_server_stats():
    """Get server statistics."""
    return JSONResponse({
        "active_sessions": game_session_manager.get_session_count(),
        "uptime": time.time() - app.state.start_time if hasattr(app.state, 'start_time') else 0
    })

if __name__ == "__main__":
    import uvicorn
    app.state.start_time = time.time()
    uvicorn.run(app, host="0.0.0.0", port=8000)
