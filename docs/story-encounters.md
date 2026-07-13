# Story encounters

RogueLLM worlds can define a visible objective and terrain-specific story
encounters. These fields are optional: older worlds receive a deterministic,
localized fallback encounter for each terrain type.

## Objective contract

The first player definition may include:

```json
{
  "objective": {
    "title": "Break the Tokyo racket",
    "description": "Defeat every gang enforcer on the map."
  }
}
```

The current runtime tracks placed map enemies. If a world has no enemies, it
tracks resolved story encounters instead.

## Encounter contract

A cell-type definition may include an `encounters` array:

```json
{
  "id": "market",
  "name": "Night Market",
  "encounters": [
    {
      "id": "locked_stall",
      "title": "The Locked Stall",
      "description": "Someone is breathing behind the shutter.",
      "resolved_description": "The shutter hangs open and silent.",
      "font_awesome_icon": "fa-solid fa-store",
      "choices": [
        {
          "id": "knock",
          "label": "Knock first",
          "result": "A frightened witness offers a useful clue.",
          "effect": {"xp": 6}
        },
        {
          "id": "force_open",
          "label": "Force it open",
          "result": "The lock breaks, along with your composure.",
          "effect": {"health": -4, "xp": 10}
        }
      ]
    }
  ]
}
```

Supported effect fields are `health`, `xp`, `item_id`, and
`combat_enemy_id`. Item and enemy references are accepted only when they match
an existing world definition. Numeric effects are bounded by the runtime.

The low-spec world model generates this structured data during world creation.
At run time, encounters are validated, placed in increasing distance bands,
resolved deterministically, and translated with the rest of the world data.
