# Phase 4b — The Region Layer

This document records the design for making a World's map read as a continuous
place rather than a scatter of unrelated settings. It follows directly from
[game-direction.md](game-direction.md) Phase 4, which put a backdrop behind the
grid and left one problem behind.

Related: [visual-assets.md](visual-assets.md) defines the art contract this
extends; [story-encounters.md](story-encounters.md) defines the encounter
contract that hangs off terrain today.

## The problem

Reported from play: standing in a convenience store, moving one cell right into
a control tower, moving right again and being back in the convenience store.
Adjacent cells have no relationship, so the World reads as random rather than as
a place.

Two separate mistakes produce it, and fixing either alone is not enough.

**1. Cell types are generated as unique buildings, then tiled.**

The map is 10x8 = 80 cells drawn from 4-6 cell types, so each type lands on
roughly 15 cells. `SYS_GEN_GAME_CELLTYPES_JSON_MSG`
(`gen_ai_prompts.py:206-209`) asks for exactly the wrong thing:

> replace each with a specific place from this setting, whether that is a server
> room, a rooftop, a loading bay, or a shrine

A World contains one control tower. Tiling it fifteen times is incoherent under
any layout. The sample file has this right - `game_celltypes.json` names Open
Ground and Shelter, which are terrain kinds that can legitimately repeat. The
prompt talks the model out of it.

**2. Nothing constrains adjacency.**

- `make_random_map` (`game_state_manager.py:374`) ends in
  `self.random.choice(cell_types)` per cell. Independent uniform draws - white
  noise with no spatial correlation at all.
- The model path (`gen_ai.gen_game_map_from_celltypes`) asks for a bare CSV with
  one line of encouragement ("Generate a map that is coherent with the game
  theme", `gen_ai_prompts.py:219`). Nothing validates contiguity, and any
  dimension or id mismatch raises, dropping the caller back into the noise
  generator.

**3. And the backdrop is a pure function of cell type.**

`gen_image.py:805-813` attaches `backdrop_url` onto each cell type;
`createApp.js:208-217` reads it off the cell under the player. So the visible
setting flips exactly when the type flips. There is no layer between "cell" and
"map" that could represent an area a player is inside of.

## Why this is Phase 4b and not part of any other phase

Phase 4 (`game-direction.md:441`) deliberately abandoned the Journey after
seeing the game with real art: combat already looks right, encounters already
render as a bottom sheet, and the map only looked bad because of hand-written
test data. The grid is staying. Phase 5 is credits and payments and does not
touch the map.

So nothing here is a stopgap for a play surface that is about to be replaced.
Phase 4 fixed "exploration shows a board, not a place". This fixes "the place
changes incoherently as you walk".

The Status list already logs a symptom: "'Abandoned Control Tower' and 'Control
Tower' both show" (`game-direction.md:509`).

## The model

Put a region between the map and the cell types, and split the two jobs that
cell type currently does.

```
World
 └── Region x3-5          contiguous set of cells - "Sector 7 Storage"
      ├── backdrop_url            <- what the player sees
      ├── name, description
      ├── borders[]               <- one line per adjacent region
      └── terrain kinds x2-3      <- open / blocked / vantage
           └── Cell: region_id + terrain_id
```

The load-bearing change is one line of ownership: **`backdrop_url` moves from
cell type to region.** Terrain keeps `map_color`, `font_awesome_icon`, and
`encounters`; it stops carrying art.

Four properties follow.

**Contiguity is guaranteed by construction, not requested.** Regions are grown
in Python by seeded BFS: drop N seeds, expand each by breadth-first steps with a
random tie-break until the grid is covered. Every region is connected by
definition. Roughly 30 lines, no model involvement, no validation needed.

**Seeds are ordered by distance from spawn**, so regions come out in a
traversal order that doubles as a difficulty ramp. That composes with the
Manhattan-distance pacing already in `ensure_entity_placement_density`
(`game_state_manager.py:429`) rather than fighting it.

**The catastrophic fallback disappears.** Today a model failure yields noise.
With partitioning in code, the fallback is structurally identical to the happy
path - the same coherent layout, only with generic region names.

**It is cost-neutral on art.** 4-6 backdrops per cell type today becomes 3-5 per
region. Same image spend, each one now covering a contiguous area instead of
fifteen scattered cells.

## What the model generates instead

Replace the CSV call entirely. The partition is known before the call, so the
adjacency graph can be handed to the model as input:

> Region A borders B and C. B borders A and D. Name these as places that fit
> together as one continuous location, and for each border write one line
> describing the transition.

This plays to what the model is good at - naming and connecting places - and
away from what it is bad at, which is emitting a spatially coherent grid of ids
at low cost. The border lines are what turns a hard cut into "the loading bay
opens onto the yard".

`gen_game_map_from_celltypes` and `SYS_GEN_MAP_CSV_MSG` are deleted.

## Touch list

| Area | File | Change |
|---|---|---|
| State | `models.py:29` | add `regions: List[dict]`; grid cells carry `region_id` |
| Partition | `game_state_manager.py:374` | replace `make_random_map` with seeded BFS |
| Generation | `gen_ai.py`, `gen_ai_prompts.py:213` | region manifest call replaces the CSV call |
| Cell types | `gen_ai_prompts.py:206` | terrain kinds, not unique buildings |
| Art | `gen_image.py:805-813` | attach `backdrop_url` per region |
| Client | `static/js/createApp.js:208` | resolve backdrop through region |
| Snapshot | `db.py:239`, `game_state_manager.py:894-985` | regions blob beside `map_csv` (step 3; step 2 derives) |
| Prose | `gen_ai_prompts.py:309` | feed the region into tile info |

Two notes on the edges of that list.

**Snapshot compatibility.** Step 2 needed no bump - see below. When step 3
persists region names, `WORLD_SNAPSHOT_VERSION` (`db.py:18`, currently 1) does
get bumped, which invalidates existing snapshots. Those already fall back to
regeneration by design (Phase 1a note 2), so old Worlds rebuild their map on the
next run rather than breaking.

**Tile prose cannot currently describe continuity even in principle.**
`SYS_GEN_TILE_QUICK_INFO_MSG` (`gen_ai_prompts.py:309-343`) receives one tile's
terrain and entity, with no neighbours and no area. Passing the region in is a
small change that makes the prose stop contradicting the picture.

## Order

1. **Cell-type prompt. Done.** Terrain kinds, not unique buildings.
2. **Partition. Done.** Contiguous areas grown in code, one terrain each.
3. **Region manifest call.** Named areas and border lines.
4. **Transition beat.** A short reveal when the player crosses a border, reusing
   the encounter bottom sheet rather than adding a new surface.

### What steps 1 and 2 actually built

Two things came out simpler than planned, both because **region and terrain are
1:1 in this step**.

**Regions are derived, not persisted.** `derive_regions`
(`game_state_manager.py`) reads the finished grid back as connected components
of equal terrain. A fresh map, a loaded snapshot, and a hand-authored config map
therefore all describe their areas the same way, and **no schema change or
`WORLD_SNAPSHOT_VERSION` bump was needed** - `map_csv` already determines the
regions. Step 3 will have to persist them, because generated names and border
lines are not derivable from the grid.

**The client needed no change at all.** Every cell in a region holds the same
terrain dict, so `currentBackdrop` (`static/js/createApp.js:208`) already
returns a constant while the player moves inside an area. The backdrop
ownership move only becomes a real edit in step 3, when a region gains its own
terrain variants.

Deriving regions this way also makes contiguity self-checking: a region that
split would show up as two components, so asserting one region per terrain is
the same assertion as "every region is contiguous".

**One region per terrain, not a fixed four.** The first cut used four regions.
That left 1-2 of the forge's 4-6 generated backdrops never shown, since the map
only ever used four terrains. Region count now follows terrain count, capped at
`MAX_REGIONS = 6`: every backdrop that was paid for is used, and areas come out
at 13-20 cells.

**The map no longer costs a model call.** `gen_game_map_from_celltypes`,
`SYS_GEN_MAP_CSV_MSG`, and `MODEL_QUALITY_FOR_MAP` are deleted. Layout is
deterministic from the run seed, so the noise fallback is gone with them - there
is no longer a failure path that produces an incoherent map.

Covered by `tests/test_region_layout.py`, which asserts contiguity, coverage,
even sizing, distinct terrain per region, spawn-outward ordering, and
determinism across 25 seeds each.

## Open questions

- How many regions for a 10x8 grid? 4 is the working assumption: about 20 cells
  each, large enough to feel like somewhere, small enough that a run sees three
  or four.
- Should region count scale with map size, or should map size become a World
  property at forge time?
- Do borders get a visible seam on the minimap, or is the backdrop change plus
  the transition line enough?
- Does terrain keep per-type `encounters` (`game_state_manager.py:637`), or do
  encounters move to the region so an area has its own story set?
