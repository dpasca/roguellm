# FontAwesome Tools

This directory contains tools for managing and validating FontAwesome icons in the project. These tools ensure that only free FontAwesome icons are used throughout the codebase.

## Tools Overview

### 1. `collect_fa_icons.py`
Fetches and saves all free FontAwesome icons from the official repository.

**Usage:**
```bash
./collect_fa_icons.py
```

**Output:**
- Creates a `fontawesome_data` directory containing:
  - `fontawesome_free_icons.json`: All free icons
  - `fontawesome_free_solid.json`: Free solid icons
  - `fontawesome_free_regular.json`: Free regular icons
  - `fontawesome_free_brands.json`: Free brand icons

### 2. `fa_validator.py`
Validates FontAwesome icons in JSON files to ensure only free icons are used.

**Usage:**
```bash
./fa_validator.py path/to/file.json [--field icon_field_name]
```

**Features:**
- Validates icons against the free FontAwesome set
- Provides detailed error messages for invalid icons
- Can be imported as a Python module for programmatic use

### 3. `find_fa_alternatives.py`
Helps find alternative free FontAwesome icons based on themes or keywords.

**Usage:**
```bash
./find_fa_alternatives.py
```

**Features:**
- Searches for theme-appropriate icons in the free set
- Provides multiple alternatives for each theme
- Useful when a Pro icon needs to be replaced with a free alternative

## Integration Example

To use the validator in your Python code:

```python
from tools.fa_validator import FontAwesomeValidator

# Initialize the validator
validator = FontAwesomeValidator()

# Check if an icon is valid
is_valid = validator.is_valid_icon("fa-solid fa-user")

# Get suggestions for invalid icons
suggestions = validator.suggest_alternatives("fa-solid fa-pro-icon")

# Validate a JSON file
errors = validator.validate_json_file("path/to/file.json")
```

## Maintenance

1. Run `collect_fa_icons.py` periodically to update the icon database with the latest free icons
2. Use `fa_validator.py` before commits to ensure no Pro icons are accidentally included
3. Use `find_fa_alternatives.py` when you need to find free alternatives for Pro icons

## Dependencies

The tools require:
- Python 3.x
- `requests` library (for fetching icon data)
