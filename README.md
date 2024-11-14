# RogueLLM

RogueLLM is an experimental roguelike game that combines traditional dungeon-crawling
mechanics with LLM (Large Language Model) integration for dynamic gameplay experiences.

The player can request **any kind of setting** for the game to be generated.
Locations, enemies, and items are all procedurally generated based on the theme requested.
The theme request can be as short as a single word (e.g. "fantasy"), or much more detailed,
up to 3,000 characters.

Play mechanics are currently limited to combat and inventory management.

![Screenshot](docs/roguellm_sshot_01.png)

## Overview

The game features:
- **LLM integration** for dynamic narrative and interactions
- Procedurally generated settings
- Item and equipment systems
- Combat mechanics
- Inventory management

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

See `game_config.json` and `game_items.json` for more details.

## Icons generation

```bash
python tools/generate_icons.py square_icon.png wide-promotional-image.png
```
