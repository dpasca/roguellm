# Workspace file for LLMs

This is a workspace document for LLMs / AI agents to use as a reference for their work.
Please, look into the TODO list below to see what's left to do.

## TODO
- [ ] Support for multiple levels.
- [ ] Add goals to beat for each level
  - [ ] One big boss to kill, or one item to collect, or person to save for each level
- [ ] Add a score table for each game

NOTE: use `~` for a task in progress, use `x` for a task completed.

## DONE
- [x] Fix progress bar for game Restart
- [x] Show enemies on the map
- [x] Fix lag when the player moves, entering a new room type and waiting for the room description to be generated
- [x] Implement support for multiple languages for the interface. Starting with "en" and "it"
- [x] Create localization script to support multiple languages (import from other project ?)

## Notes

Set `DO_BYPASS_WORLD_GEN = True` in `gen_ai.py` to speedup some testing during development.