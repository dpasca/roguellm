#!/bin/bash

# Set script to exit on error
set -e

# Get the directory containing the script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# Get the repository root directory (parent of tools directory)
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

# Create virtual environment if it doesn't exist
if [ ! -d "$SCRIPT_DIR/venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv "$SCRIPT_DIR/venv"
fi

# Activate virtual environment
source "$SCRIPT_DIR/venv/bin/activate"

# Install/upgrade pip and install requirements
pip install --upgrade pip
pip install -r "$REPO_ROOT/requirements.txt"

# Run the Python script with the correct paths
python "$SCRIPT_DIR/update_locales.py" "$REPO_ROOT/static/translations" "it,ja,es,zh-Hant"

# Deactivate virtual environment
deactivate