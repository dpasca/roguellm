# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Development Commands

### Environment Setup
```bash
# Initial setup (automated)
./setup_dev.sh

# Manual environment activation
source venv/bin/activate
# OR use convenience script
source activate.sh

# Deactivate environment
deactivate
```

### Running the Application
```bash
# Start development server (with auto-reload)
./run.sh
# OR manually
uvicorn main:app --reload

# Access application at http://127.0.0.1:8000/
```

### API Key Configuration
Before running, create `.env` file from `_env.example` template with required API keys:
- `LOW_SPEC_MODEL_API_KEY` and `HIGH_SPEC_MODEL_API_KEY` (OpenAI by default)
- Optional: Firebase Analytics configuration
- Optional: Search provider (SerpApi or DuckDuckGo)

### Testing and Cache Management
```bash
# List cached game instances (for testing)
python tools/test_cache.py list

# Clear all cached instances
python tools/test_cache.py clear

# Clear cache for specific generator
python tools/test_cache.py clear --generator-id <id>

# Clear cache via API
python tools/test_cache.py clear-api
```

### Icon Generation
```bash
python tools/generate_icons.py square_icon.png wide-promotional-image.png
```

## Architecture Overview

RogueLLM is a FastAPI-based roguelike game that uses LLMs to procedurally generate game content including maps, enemies, items, and narratives based on user-provided themes.

### Core Components

**main.py** - FastAPI application server with:
- Session-based game management (`GameSessionManager`)
- WebSocket endpoints for real-time game communication
- Static file serving and routing
- API endpoints for game creation and cache management

**game.py** - Main game orchestrator that coordinates:
- State management through `GameStateManager`
- Player actions via `PlayerActionHandler`
- WebSocket communication through `WebSocketHandler`
- Combat mechanics via `CombatManager`

**Key Architectural Patterns:**

1. **Component-Based Design**: Game functionality is split into specialized managers (StateManager, CombatManager, EntityPlacementManager, etc.)

2. **Factory Pattern**: `Game.create()` async factory method properly initializes all components with LLM-generated content

3. **Session Management**: Games are managed as sessions with unique IDs, supporting both generator-based sharing and direct session access

4. **LLM Integration**: `gen_ai.py` handles all AI interactions, with `GameDefinitionsManager` transforming JSON templates into theme-specific content

5. **Database Layer**: `db.py` provides persistence for generators, game instances, and caching

### Key Files by Functionality

**Game Logic:**
- `game_state_manager.py` - Core game state and map management
- `player_action_handler.py` - Handles all player interactions (movement, inventory, combat)
- `combat_manager.py` - Turn-based combat system
- `entity_placement_manager.py` - Places enemies and items on generated maps

**LLM Integration:**
- `gen_ai.py` - Main AI interface supporting multiple providers (OpenAI, Gemini)
- `gen_ai_prompts.py` - All LLM prompts for content generation
- `game_definitions.py` - Transforms base JSON templates using AI

**Data Models:**
- `models.py` - Pydantic models for game state, entities, items
- `websocket_schemas.py` - WebSocket message schemas
- `game_*.json` - Base templates for players, enemies, items, cell types

**Frontend:**
- `static/js/threejs/` - 3D rendering system for game visualization
- `static/js/components/` - UI components
- `static/game.html` - Main game interface

### Important Configuration

**Environment Variables:**
- API keys are required for LLM providers
- `USE_CACHED_GAME_INSTANCES=true` enables testing mode with cached content
- Firebase Analytics is optional

**Game Configuration:**
- `game_config.json` - Core game parameters
- Theme descriptions can be 1-3000 characters and are used to generate all content
- Generator IDs enable sharing of specific game worlds

### Development Notes

- The application uses async/await patterns throughout
- WebSocket connections handle real-time game communication
- Pre-commit hooks are available for code quality
- The codebase supports both 2D and 3D rendering modes
- Entity icons are managed through FontAwesome integration (`tools/fa_runtime.py`)