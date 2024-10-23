# RogueLLM

RogueLLM is an experimental roguelike game that combines traditional dungeon-crawling
mechanics with LLM (Large Language Model) integration for dynamic gameplay experiences.

## Overview

The game features:
- Procedurally generated dungeons
- Item and equipment systems
- Combat mechanics
- Inventory management
- Seed-based randomization for reproducible gameplay
- (WIP) LLM integration for dynamic narrative and interactions

## Installation

### Prerequisites
- Python 3.10 or higher
- pip package manager

### Setting up Virtual Environment

#### For MacOS/Linux:
```bash
python3 -m venv venv
source venv/bin/activate
```

#### For Windows:
```bash
python -m venv venv
venv\Scripts\activate
```

### Installing Dependencies
```bash
pip install -r requirements.txt
```

## Running the Game
1. Launch with `./run.sh` for MacOS/Linux or `run.bat` for Windows.
2. Open browser and navigate to `http://127.0.0.1:8000/`.

## Game Configuration
The game uses configuration files for:
- Map dimensions
- Player stats
- Items and equipment
- Combat parameters

See `game_config.json` and `game_items.json` for more details.

## Development Status
- Core game mechanics: Implemented
- Basic combat system: Implemented
- Item system: Implemented
- LLM Integration: Work in Progress