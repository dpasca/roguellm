from openai import AsyncOpenAI
import random
from typing import Any, Dict, List, Optional
from models import GameState
import json
from openai._types import NOT_GIVEN, NotGiven
from openai._client import Timeout, Transport
from openai._base_client import DEFAULT_MAX_RETRIES

from gen_ai_prompts import (
    SYS_BETTER_DESC_PROMPT_MSG,
    SYS_GENERAL_JSON_RULES_MSG,
    SYS_GEN_PLAYER_JSON_MSG,
    SYS_GEN_GAME_ITEMS_JSON_MSG,
    SYS_GEN_GAME_ENEMIES_JSON_MSG,
    SYS_GEN_GAME_CELLTYPES_JSON_MSG,
    SYS_TRANSLATE_WORLD_JSON_MSG,
    SYS_GEN_ENTITY_PLACEMENT_MSG,
    SYS_GEN_REGION_BORDERS_MSG,
    SYS_GEN_TILE_QUICK_INFO_MSG,
    SYS_GEN_VISUAL_MANIFEST_MSG,
    ADAPT_SENTENCE_SYSTEM_MSG,
    ROOM_DESC_SYSTEM_MSG,
    DUMMY_PLACEMENTS,
    append_language_and_desc_to_prompt,
    append_desc_to_prompt
)
from gen_ai_utils import extract_clean_data, make_query_and_web_search, get_language_name, with_exponential_backoff
from gen_image import normalize_visual_manifest
from privacy_logging import (
    describe_collection,
    describe_text,
    is_sensitive_content_logging_enabled,
)

import logging
logger = logging.getLogger()

# Constants
DO_BYPASS_WORLD_GEN = False

# Model quality levels
MODEL_QUALITY_LOW = "low"
MODEL_QUALITY_HIGH = "high"

# Model quality settings for different tasks
MODEL_QUALITY_FOR_JSON = MODEL_QUALITY_LOW
MODEL_QUALITY_FOR_THEME_DESC = MODEL_QUALITY_LOW

# Reasoning effort is the generation-control knob. Only the reasoning families
# accept the parameter, so it is stripped for anything older, which would 400.
REASONING_MODEL_PREFIXES = ("gpt-5.", "gpt-5-", "o1", "o3", "o4")

# gpt-4.1-mini, the previous default, deprecates 2026-11-04 and costs more than
# Luna does. Luna is the cheap bulk tier; Terra is the real high tier, which the
# old defaults never provided because both tiers named the same model.
#
# Luna runs at high effort rather than none: it is cheap enough per token that
# reasoning is worth buying, and worldgen quality is the whole product.
DEFAULT_LOW_SPEC_MODEL = "gpt-5.6-luna"
DEFAULT_HIGH_SPEC_MODEL = "gpt-5.6-terra"
DEFAULT_LOW_SPEC_EFFORT = "high"
DEFAULT_HIGH_SPEC_EFFORT = "low"


def model_takes_reasoning_effort(model_name: str) -> bool:
    return bool(model_name) and model_name.startswith(REASONING_MODEL_PREFIXES)


def resolve_reasoning_effort(model_name: str, requested: Optional[str]) -> Optional[str]:
    """Drop the effort setting for models that would reject the parameter.

    The tier defaults live in the caller, so a deployment that still pins
    gpt-4.1-mini in its .env keeps working untouched after the gpt-5.6 swap.
    """
    if not requested:
        return None
    if not model_takes_reasoning_effort(model_name):
        logger.info(
            "Ignoring reasoning effort %r: model %s does not accept it",
            requested,
            model_name,
        )
        return None
    return requested

def log_token_usage(model_name: str, usage: Any) -> None:
    """Record what one call actually cost in tokens.

    Reasoning tokens are billed as output but are not in the visible response,
    so prompt and completion lengths alone understate a forge. Credits pricing
    depends on knowing the real number.
    """
    if usage is None:
        return
    details = getattr(usage, "completion_tokens_details", None)
    reasoning = getattr(details, "reasoning_tokens", None) if details else None
    logger.info(
        "Token usage model=%s prompt=%s completion=%s reasoning=%s total=%s",
        model_name,
        getattr(usage, "prompt_tokens", "?"),
        getattr(usage, "completion_tokens", "?"),
        reasoning if reasoning is not None else "n/a",
        getattr(usage, "total_tokens", "?"),
    )


def normalize_generated_defs(data: Any) -> List[dict]:
    """Coerce one generation response into the inner definition list.

    The model returns the right content in the wrong container often enough to
    matter, and not on every call, so it slips through a single manual test. All
    three wrong shapes seen in practice are handled here rather than at each
    consumer, since only some of them defended against it: gen_visual_manifest
    sliced a bare object and raised KeyError mid-forge.
    """
    if isinstance(data, list):
        return [entry for entry in data if isinstance(entry, dict)]
    if not isinstance(data, dict):
        return []

    # {"player_defs": [...]} - the array wrapped under one key
    if len(data) == 1:
        only = next(iter(data.values()))
        if isinstance(only, list):
            return [entry for entry in only if isinstance(entry, dict)]

    # {"0": {...}, "1": {...}} - keyed by id, so the key carries it
    values = list(data.values())
    if values and all(isinstance(value, dict) for value in values):
        normalized = []
        for key, value in data.items():
            entry = dict(value)
            entry.setdefault("id", str(key))
            normalized.append(entry)
        return normalized

    # A bare entity, which is what a one-element sample tends to produce
    return [data]


def json_schema_from_sample(sample: Any) -> Dict[str, Any]:
    """Build the strict JSON Schema subset used by Structured Outputs.

    Definition samples are also the runtime contract. Deriving the schema from
    them keeps that contract in one place and allows arrays to contain the
    handful of object variants present in the samples, such as item effects.
    """
    if sample is None:
        return {"type": "null"}
    if isinstance(sample, bool):
        return {"type": "boolean"}
    if isinstance(sample, int):
        return {"type": "integer"}
    if isinstance(sample, float):
        return {"type": "number"}
    if isinstance(sample, str):
        return {"type": "string"}
    if isinstance(sample, dict):
        return {
            "type": "object",
            "properties": {
                key: json_schema_from_sample(value)
                for key, value in sample.items()
            },
            "required": list(sample.keys()),
            "additionalProperties": False,
        }
    if isinstance(sample, list):
        item_schemas = []
        signatures = set()
        for item in sample:
            schema = json_schema_from_sample(item)
            signature = json.dumps(schema, sort_keys=True, separators=(",", ":"))
            if signature not in signatures:
                signatures.add(signature)
                item_schemas.append(schema)

        if not item_schemas:
            raise ValueError("Structured-output samples cannot contain an empty array")
        items = item_schemas[0] if len(item_schemas) == 1 else {"anyOf": item_schemas}
        return {"type": "array", "items": items}

    raise TypeError(f"Unsupported structured-output sample type: {type(sample).__name__}")


def generated_defs_response_format(
        definition_key: str,
        template_defs: List[dict],
) -> Dict[str, Any]:
    """Describe one generated definition payload for Chat Completions."""
    return {
        "type": "json_schema",
        "json_schema": {
            "name": f"generated_{definition_key}",
            "schema": json_schema_from_sample({definition_key: template_defs}),
            "strict": True,
        },
    }


WORLD_TRANSLATION_FIELDS = (
    "theme_desc_better",
    "player_defs",
    "item_defs",
    "enemy_defs",
    "celltype_defs",
)
PRESERVED_WORLD_FIELD_NAMES = {
    "id",
    "enemy_id",
    "type",
    "effect",
    "hp",
    "attack",
    "defense",
    "xp",
    "font_awesome_icon",
    "map_color",
    "sprite_url",
    "sprite_token_url",
    "sprite_frames",
    "backdrop_url",
}
TRANSLATABLE_STRING_LIST_FIELD_NAMES = {"weapons"}

#==================================================================
# GenAI
#==================================================================
class GenAIModel:
    def __init__(self, model_name=None, base_url=None, api_key=None, reasoning_effort=None):
        self.model_name = model_name
        self.base_url = base_url
        self.api_key = api_key
        self.reasoning_effort = resolve_reasoning_effort(model_name, reasoning_effort)

        # Validate API key
        if not self.api_key:
            raise ValueError(
                "API key is required but not provided. Please set the appropriate environment variables:\n"
                "- LOW_SPEC_MODEL_API_KEY for low-spec model\n"
                "- HIGH_SPEC_MODEL_API_KEY for high-spec model\n"
                "You can get an OpenAI API key from: https://platform.openai.com/api-keys\n"
                "Create a .env file with your API keys (see _env.example for an example)"
            )

        # Custom timeout and retry settings for non-OpenAI models
        timeout = Timeout(
            connect=5.0,    # How long to wait for a connection
            read=15.0,      # How long to wait for data
            write=5.0,      # How long to wait to send data
            pool=5.0,       # How long to wait for a connection from the pool
        )

        # Disable built-in retries since we handle them at a higher level
        self.client = AsyncOpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
            #max_retries=0,  # Disable automatic retries
            #timeout=timeout
        )

    def completion_params(self) -> Dict[str, Any]:
        """Build the per-model half of a chat completion request."""
        params: Dict[str, Any] = {"model": self.model_name}
        if self.reasoning_effort:
            params["reasoning_effort"] = self.reasoning_effort
        return params

# GenAI
class GenAI:

    def __init__(
        self,
        lo_model: GenAIModel,
        hi_model: GenAIModel,
        random_seed: int = 0,
    ):
        self.random = random.Random(random_seed)
        self.lo_model = lo_model
        self.hi_model = hi_model
        self.theme_desc = None
        self.theme_desc_better = None
        self.do_web_search = False
        self.language = "en"
        self.game_title = None

        logger.info(f"Low spec model: {self.lo_model.model_name}")
        logger.info(f"High spec model: {self.hi_model.model_name}")

    async def _quick_completion(
            self,
            system_msg: str,
            user_msg: str,
            quality: str,
            response_format: Optional[Dict[str, Any]] = None,
    ):
        use_model = self.hi_model if quality == MODEL_QUALITY_HIGH else self.lo_model
        logger.info(
            "Requesting completion with model %s (system=%s, user=%s)",
            use_model.model_name,
            describe_text(system_msg),
            describe_text(user_msg),
        )
        if is_sensitive_content_logging_enabled():
            logger.info("System message: %s", system_msg)
            logger.info("User message: %s", user_msg)

        try:
            async def get_completion(with_response_format: bool):
                params = dict(use_model.completion_params())
                if with_response_format and response_format is not None:
                    params["response_format"] = response_format
                return await use_model.client.chat.completions.create(
                    messages=[
                        {"role": "system", "content": system_msg},
                        {"role": "user", "content": user_msg}
                    ],
                    **params
                )

            try:
                response = await with_exponential_backoff(
                    lambda: get_completion(response_format is not None)
                )
            except Exception:
                if response_format is None:
                    raise
                logger.warning(
                    "Structured response format failed for model %s; retrying without it.",
                    use_model.model_name,
                )
                response = await with_exponential_backoff(lambda: get_completion(False))

            result = response.choices[0].message.content or ""
            logger.info("Obtained completion (%s)", describe_text(result))
            log_token_usage(use_model.model_name, getattr(response, "usage", None))
            if is_sensitive_content_logging_enabled():
                logger.info("Obtained completion content: %s", result)
            return result
        except Exception as e:
            logger.error(f"Error in _quick_completion: {e}")
            raise  # Re-raise the exception to let the caller handle it

    # Validate any font-awesome icons in the data structure.
    def _validate_icons(self, data: dict, context: str = "default") -> dict:
        from tools.fa_runtime import fa_runtime
        return fa_runtime.process_game_data(data, context)

    # Upon setting the theme description, translate the basic system prompts
    async def set_theme_description(
            self,
            theme_desc: str,
            theme_desc_better: str,
            do_web_search: bool,
            language: str,
    ) -> str:
        self.theme_desc = theme_desc
        self.theme_desc_better = theme_desc_better
        self.do_web_search = do_web_search
        self.language = language

        if not self.theme_desc_better:
            logger.info("Generating theme description 'better'")
            await self.gen_theme_desc_better()

        # Extract the game title from the theme description
        self.game_title = self.theme_desc_better.split("\n")[0]
        logger.info("Game title generated (%s)", describe_text(self.game_title))

        return self.theme_desc_better

    async def translate_world_definition(
            self,
            world_definition: Dict[str, Any],
            source_language: str,
            target_language: str,
    ) -> Dict[str, Any]:
        """Translate saved world definitions while preserving gameplay fields."""
        logger.info(
            "Translating world definition from %s to %s",
            source_language,
            target_language,
        )
        response = await self._quick_completion(
            system_msg=(
                SYS_TRANSLATE_WORLD_JSON_MSG +
                f"\nSource language: {get_language_name(source_language)}" +
                f"\nTarget language: {get_language_name(target_language)}"
            ),
            user_msg=json.dumps(world_definition, ensure_ascii=False),
            quality=MODEL_QUALITY_FOR_JSON,
        )

        try:
            translated = json.loads(extract_clean_data(response))
        except json.JSONDecodeError as e:
            logger.error("Invalid translated world JSON (%s)", describe_text(response))
            raise ValueError("World translation response was not valid JSON") from e

        return self._normalize_translated_world_definition(world_definition, translated)

    def _normalize_translated_world_definition(
            self,
            source: Dict[str, Any],
            translated: Dict[str, Any],
    ) -> Dict[str, Any]:
        if not isinstance(translated, dict):
            raise ValueError("World translation must be a JSON object")

        missing_fields = [field for field in WORLD_TRANSLATION_FIELDS if field not in translated]
        if missing_fields:
            raise ValueError(f"World translation is missing fields: {missing_fields}")

        if not isinstance(translated["theme_desc_better"], str):
            raise ValueError("Translated theme_desc_better must be a string")

        protected_terms = self._collect_protected_world_terms(source)
        normalized = {
            "theme_desc_better": self._restore_theme_title_protected_terms(
                source["theme_desc_better"],
                translated["theme_desc_better"],
                protected_terms,
            )
        }
        for field in WORLD_TRANSLATION_FIELDS[1:]:
            normalized[field] = self._merge_translated_world_value(
                source[field],
                translated[field],
                field,
                field,
                protected_terms,
            )
        return normalized

    def _collect_protected_world_terms(self, source: Dict[str, Any]) -> tuple[str, ...]:
        terms = []
        for player_def in source.get("player_defs", []):
            if not isinstance(player_def, dict):
                continue
            name = player_def.get("name")
            if isinstance(name, str) and name.strip() and name not in terms:
                terms.append(name)
        return tuple(terms)

    def _restore_theme_title_protected_terms(
            self,
            source_value: str,
            translated_value: str,
            protected_terms: tuple[str, ...],
    ) -> str:
        source_lines = source_value.splitlines()
        translated_lines = translated_value.splitlines()
        if not source_lines or not translated_lines:
            return translated_value

        if self._is_missing_protected_term(source_lines[0], translated_lines[0], protected_terms):
            translated_lines[0] = source_lines[0]
        return "\n".join(translated_lines)

    def _is_missing_protected_term(
            self,
            source_value: str,
            translated_value: str,
            protected_terms: tuple[str, ...],
    ) -> bool:
        return any(term in source_value and term not in translated_value for term in protected_terms)

    def _merge_translated_world_value(
            self,
            source_value: Any,
            translated_value: Any,
            path: str,
            field_name: str,
            protected_terms: tuple[str, ...],
    ) -> Any:
        if field_name in PRESERVED_WORLD_FIELD_NAMES:
            return source_value

        if isinstance(source_value, dict):
            if not isinstance(translated_value, dict):
                raise ValueError(f"Translated world field {path} must be an object")

            return {
                key: self._merge_translated_world_value(
                    value,
                    translated_value.get(key, value),
                    f"{path}.{key}",
                    key,
                    protected_terms,
                )
                for key, value in source_value.items()
            }

        if isinstance(source_value, list):
            if not isinstance(translated_value, list):
                raise ValueError(f"Translated world field {path} must be a list")
            if len(source_value) != len(translated_value):
                raise ValueError(f"Translated world field {path} changed list length")

            if all(isinstance(item, str) for item in source_value):
                if field_name in TRANSLATABLE_STRING_LIST_FIELD_NAMES:
                    return [
                        item if isinstance(item, str) else source_value[index]
                        for index, item in enumerate(translated_value)
                    ]
                return list(source_value)

            return [
                self._merge_translated_world_value(
                    source_item,
                    translated_item,
                    f"{path}[{index}]",
                    field_name,
                    protected_terms,
                )
                for index, (source_item, translated_item) in enumerate(zip(source_value, translated_value))
            ]

        if isinstance(source_value, str):
            if not isinstance(translated_value, str):
                raise ValueError(f"Translated world field {path} must be a string")
            if field_name == "name" and self._is_missing_protected_term(
                source_value,
                translated_value,
                protected_terms,
            ):
                return source_value
            return translated_value

        return source_value

    # Generate a better/extended theme description
    async def gen_theme_desc_better(self):
        if DO_BYPASS_WORLD_GEN: # Quick version for testing
            self.theme_desc_better = f"""
Generic Game (TEST)
A universe where you can become the master of the universe by defeating other masters.
- Locations: dungeon, castle, village, forest, mountain, desert, space station, alien planet
- The language of the response must be: {get_language_name(self.language)}
"""
        else:
            research_result = ""
            if self.do_web_search:
                research_result = await make_query_and_web_search(
                    self.lo_model.client,
                    self.lo_model.completion_params(),
                    self.theme_desc,
                    self.language
                )

            if research_result:
                self.theme_desc += f"\n\n# Web Search Results\n{research_result}"

            self.theme_desc_better = await self._quick_completion(
                system_msg=(
                    SYS_BETTER_DESC_PROMPT_MSG +
                    f"\n- The language of the response must be: {get_language_name(self.language)}"
                ),
                user_msg=self.theme_desc,
                quality=MODEL_QUALITY_FOR_THEME_DESC
            )
        logger.info("Theme description 'better' generated (%s)", describe_text(self.theme_desc_better))

    @staticmethod
    def _make_formatted_events(event_history: List[dict]) -> List[str]:
        formatted_events = []
        RELEVANT_EVENTS = 5
        for event in event_history[-RELEVANT_EVENTS:]:  # Keep last N events
            action = event.get('action', 'unknown')
            # The description is directly in the event, not nested under 'event'
            description = event.get('description', event.get('description_raw', 'No description'))
            formatted_events.append(f"[{action}] {description}")
        return formatted_events

    def _create_context(self, gstate: GameState, event_history: List[dict]) -> str:
        """Create a context string for the LLM based on game state and recent history."""
        context = []

        # Add current position and exploration status
        x, y = gstate.player_pos
        was_explored = gstate.explored[y][x]

        ct_name = gstate.cell_types[y][x]['name']
        ct_desc = gstate.cell_types[y][x]['description']
        context.append(f"Current position: ({x}, {y}) of a {gstate.map_width}x{gstate.map_height} map")
        context.append(f"Current location type: {ct_name} ({ct_desc})")

        px, py = gstate.player_pos_prev
        if px != x or py != y:
            context.append(f"Previous position: ({px}, {py})")
            pct_name = gstate.cell_types[py][px]['name']
            pct_desc = gstate.cell_types[py][px]['description']
            context.append(f"Previous location type: {pct_name} ({pct_desc})")

        if was_explored:
            context.append("This location has been previously explored.")
            # Add previous room description if it exists
            if event_history:
                previous_descriptions = [
                    event.get('description', event.get('description_raw', ''))
                    for event in event_history
                    if event.get('type') == 'update'
                    and event.get('action') in ['move', 'initialize']
                    and (event.get('state', {}).get('player_pos') == (x, y))
                ]
                if previous_descriptions:
                    context.append(f"Previous description of this room: {previous_descriptions[-1]}")
                else:
                    context.append("No previous room description available.")
            else:
                # Handle the case where there's no event history yet (e.g., during initialization)
                context.append("No previous room description available (first visit).")

        # Add player status
        health_pct = int(gstate.player_hp / gstate.player_max_hp * 100.0)
        context.append(f"Player status: HP {health_pct}%")

        # Add combat status if in combat
        if gstate.in_combat and gstate.current_enemy:
            enemy = gstate.current_enemy
            enemy_health_pct = int(enemy.hp / enemy.max_hp * 100.0)
            context.append(f"In combat with {enemy.name} (HP {enemy_health_pct}%)")
            if enemy.weapons:
                context.append(f"Enemy is armed with: {', '.join(enemy.weapons)}")

        # Add recent events (limited to prevent context exploitation)
        if event_history:
            formatted_events = self._make_formatted_events(event_history)
            context.append("")
            context.append("# Recent events")
            context.extend([f"- {event}" for event in formatted_events])
        else:
            context.append("")
            context.append("# Recent events")
            context.append("- No events yet (game just started)")

        # Add equipment info
        if gstate.equipment.weapon or gstate.equipment.armor:
            context.append("")
            context.append("# Equipment")
            if gstate.equipment.weapon:
                context.append(f"Wielding: {gstate.equipment.weapon.name}")
            if gstate.equipment.armor:
                context.append(f"Wearing: {gstate.equipment.armor.name}")

        return "\n".join(context)

    # Generate a list of game elements from a JSON samples + system prompt
    async def _gen_game_elems_from_json_sample(
            self,
            json_template: str,
            system_msg: str,
            definition_key: str,
    ) -> Dict[str, List[dict]]:

        system_msg = append_language_and_desc_to_prompt(
            # NOTE: We're adding the general JSON rules to help against bad formatting
            system_msg + SYS_GENERAL_JSON_RULES_MSG,
            self.language,
            self.theme_desc
        )
        # Verify that the input is valid JSON
        try:
            template_defs = normalize_generated_defs(json.loads(json_template))
        except json.JSONDecodeError:
            logger.error("Invalid JSON input template (%s)", describe_text(json_template))
            raise ValueError("Invalid JSON input")

        template_object = {definition_key: template_defs}
        if DO_BYPASS_WORLD_GEN:
            return template_object

        # Generate a new list of items
        response = await self._quick_completion(
            system_msg=system_msg,
            user_msg=json.dumps(template_object, ensure_ascii=False),
            quality=MODEL_QUALITY_FOR_JSON,
            response_format=generated_defs_response_format(definition_key, template_defs),
        )
        # Keep the public return shape identical to the template files. The
        # inner normalizer still repairs known shapes when a compatible model
        # rejects response_format and the fallback returns loose JSON.
        try:
            data = normalize_generated_defs(json.loads(extract_clean_data(response)))
            if not data:
                logger.error("Generated definitions were empty (%s)", describe_text(response))
                return template_object
            # Validate any font-awesome icons in the data
            data = self._validate_icons(data)
            return {definition_key: data}
        except json.JSONDecodeError:
            # Fallback to the original definitions if the response is broken
            logger.error("Invalid JSON output (%s)", describe_text(response))
            return template_object

    async def gen_players_from_json_sample(self, player_defs: str) -> Dict[str, List[dict]]:
        return await self._gen_game_elems_from_json_sample(
            player_defs,
            SYS_GEN_PLAYER_JSON_MSG,
            "player_defs",
        )

    async def gen_game_items_from_json_sample(self, item_defs: str) -> Dict[str, List[dict]]:
        return await self._gen_game_elems_from_json_sample(
            item_defs,
            SYS_GEN_GAME_ITEMS_JSON_MSG,
            "item_defs",
        )

    async def gen_game_enemies_from_json_sample(self, enemy_defs: str) -> Dict[str, List[dict]]:
        return await self._gen_game_elems_from_json_sample(
            enemy_defs,
            SYS_GEN_GAME_ENEMIES_JSON_MSG,
            "enemy_defs",
        )

    async def gen_game_celltypes_from_json_sample(self, celltype_defs: str) -> Dict[str, List[dict]]:
        return await self._gen_game_elems_from_json_sample(
            celltype_defs,
            SYS_GEN_GAME_CELLTYPES_JSON_MSG,
            "celltype_defs",
        )

    # Generate strategic entity placements (both enemies and items)
    async def gen_entity_placements(
            self,
            cell_types: List[List[dict]],
            enemy_defs: List[dict],
            item_defs: List[dict],
            map_width: int,
            map_height: int
    ) -> List[dict]:
        # Create a string representation of the map for the LLM
        map_desc = []
        for y in range(map_height):
            row = []
            for x in range(map_width):
                cell = cell_types[y][x]
                row.append(f"{cell['name']} ({cell['id']})")
            map_desc.append(" | ".join(row))
        map_str = "\n".join(map_desc)

        # Format enemy definitions
        enemy_desc = []
        for enemy in enemy_defs:
            enemy_desc.append(
                f"ID: {enemy['enemy_id']}, " +
                f"Name: {enemy['name']}, " +
                f"HP: {enemy['hp']['min']}-{enemy['hp']['max']}, " +
                f"Attack: {enemy['attack']['min']}-{enemy['attack']['max']}"
            )
        enemy_str = "\n".join(enemy_desc)

        # Format item definitions
        item_desc = []
        for item in item_defs:
            effects = []
            for k, v in item['effect'].items():
                effects.append(f"{k}: {v}")
            item_desc.append(
                f"ID: {item['id']}, " +
                f"Name: {item['name']}, " +
                f"Type: {item['type']}, " +
                f"Effects: {', '.join(effects)}"
            )
        item_str = "\n".join(item_desc)

        # Create user message
        user_msg = f"""Here is the map layout (width: {map_width}, height: {map_height}):
{map_str}

Available enemy types:
{enemy_str}

Available items:
{item_str}

Place both enemies and items strategically on this map, considering the terrain types and theme.
For enemies, use their exact enemy_id, and for items use their exact item_id.
Each placement should indicate whether it's an enemy or an item.
"""

        if DO_BYPASS_WORLD_GEN:
            placements_json = DUMMY_PLACEMENTS
        else:
            response = await self._quick_completion(
                system_msg=append_desc_to_prompt(
                    SYS_GEN_ENTITY_PLACEMENT_MSG,
                    self.theme_desc_better),
                user_msg=user_msg,
                quality=MODEL_QUALITY_FOR_JSON)
            placements_json = extract_clean_data(response)

        # Parse the response
        try:
            placements = json.loads(placements_json)
            logger.info("Generated entity placements (%s)", describe_collection(placements))
            if is_sensitive_content_logging_enabled():
                logger.info("Entity placements: %s", placements_json)
            return placements
        except json.JSONDecodeError as e:
            logger.error(
                "Invalid JSON in entity placement:\n" +
                f"Error: {str(e)}\nPosition: {e.pos}\n" +
                f"Line: {e.lineno}, Column: {e.colno}\n" +
                f"JSON content: {describe_text(placements_json)}")
            return []

    async def gen_visual_manifest(
            self,
            player_defs: List[dict],
            enemy_defs: List[dict],
            celltype_defs: Any,
    ) -> Optional[dict]:
        """Emit the shared art direction that keeps a World's assets coherent.

        Every image is generated in a separate call, so without one manifest
        describing a single style, palette, and cast, the assets read as a dozen
        different games. Returns None when the model gives back something
        unusable; the caller then skips art rather than generating a mess.
        """
        if DO_BYPASS_WORLD_GEN:
            return None

        # Saved worlds predate the normalization above and still hold either
        # shape, so every list is coerced here too rather than only at forge time.
        celltype_list = normalize_generated_defs(celltype_defs)
        player_list = normalize_generated_defs(player_defs)
        enemy_list = normalize_generated_defs(enemy_defs)

        world = {
            "title_and_summary": self.theme_desc_better,
            "player": [
                {"id": "player", "name": p.get("name"), "class": p.get("class"),
                 "description": p.get("description")}
                for p in player_list[:1]
            ],
            "enemies": [
                {"id": e.get("enemy_id"), "name": e.get("name"),
                 "description": e.get("description")}
                for e in enemy_list
                if e.get("enemy_id")
            ],
            "terrain": [
                {"id": c.get("id"), "name": c.get("name"),
                 "description": c.get("description")}
                for c in celltype_list
                if c.get("id")
            ],
        }

        response = await self._quick_completion(
            system_msg=append_desc_to_prompt(
                SYS_GEN_VISUAL_MANIFEST_MSG + SYS_GENERAL_JSON_RULES_MSG,
                self.theme_desc_better
            ),
            user_msg=json.dumps(world, ensure_ascii=False),
            quality=MODEL_QUALITY_FOR_JSON,
        )

        try:
            manifest = json.loads(extract_clean_data(response))
        except json.JSONDecodeError:
            logger.error("Invalid visual manifest JSON (%s)", describe_text(response))
            return None

        return normalize_visual_manifest(manifest, world)

    async def gen_region_borders(self, regions: List[dict]) -> Dict[str, Dict[str, str]]:
        """Describe each crossing between two areas, in both directions.

        The adjacency is computed from the finished map, so the model is told the
        geography rather than asked to invent one. Returns {from: {to: line}};
        an empty result costs only the crossing text, not the run.
        """
        if DO_BYPASS_WORLD_GEN or len(regions) < 2:
            return {}

        by_id = {region["id"]: region for region in regions}
        pairs = [
            {"from": region["id"], "to": neighbour}
            for region in regions
            for neighbour in region.get("neighbours") or []
            if neighbour in by_id
        ]
        if not pairs:
            return {}

        user_msg = json.dumps({
            # Only the name: areas are derived from terrain and carry no
            # description, so sending one would send null on every entry.
            "areas": [{"id": r["id"], "name": r.get("name")} for r in regions],
            "crossings": pairs,
        }, ensure_ascii=False)

        logger.info("Generating %s area crossings for %s areas", len(pairs), len(regions))
        response = await self._quick_completion(
            system_msg=append_language_and_desc_to_prompt(
                SYS_GEN_REGION_BORDERS_MSG + SYS_GENERAL_JSON_RULES_MSG,
                self.language,
                self.theme_desc_better
            ),
            user_msg=user_msg,
            quality=MODEL_QUALITY_FOR_JSON,
        )

        try:
            data = json.loads(extract_clean_data(response))
        except json.JSONDecodeError:
            logger.error("Invalid area crossing JSON (%s)", describe_text(response))
            return {}

        borders: Dict[str, Dict[str, str]] = {}
        for entry in (data.get("borders") if isinstance(data, dict) else None) or []:
            if not isinstance(entry, dict):
                continue
            source, target = entry.get("from"), entry.get("to")
            line = (entry.get("line") or "").strip()
            # Ids are invented often enough to be worth checking; a made-up
            # crossing would sit in the data and never be shown.
            if line and source in by_id and target in by_id:
                borders.setdefault(str(source), {})[str(target)] = line

        logger.info("Obtained %s of %s area crossings", sum(len(v) for v in borders.values()), len(pairs))
        return borders

    async def gen_tile_quick_info(
            self,
            cell_types: List[List[dict]],
            placements: List[dict],
            enemy_defs: List[dict],
            item_defs: List[dict],
            map_width: int,
            map_height: int,
            region_ids: Optional[List[List[str]]] = None,
            regions: Optional[List[dict]] = None,
    ) -> List[dict]:
        """Generate prebuilt tile summaries for fast, model-free gameplay turns."""
        if DO_BYPASS_WORLD_GEN:
            return []

        placements_by_pos = {
            (placement.get("x"), placement.get("y")): placement
            for placement in placements
            if isinstance(placement, dict)
        }
        enemies_by_id = {
            enemy.get("enemy_id"): enemy
            for enemy in enemy_defs
            if isinstance(enemy, dict)
        }
        items_by_id = {
            item.get("id"): item
            for item in item_defs
            if isinstance(item, dict)
        }

        # Naming the area on every tile is what lets the prompt ask for variety
        # within it: without this the model sees identical tiles and repeats.
        region_names = {
            region.get("id"): region.get("name")
            for region in (regions or [])
            if isinstance(region, dict)
        }

        tiles = []
        for y in range(map_height):
            for x in range(map_width):
                cell = cell_types[y][x]
                terrain_name = cell.get("name", "Unknown") if isinstance(cell, dict) else str(cell)
                terrain_description = cell.get("description", "") if isinstance(cell, dict) else str(cell)
                tile = {
                    "x": x,
                    "y": y,
                    "terrain_name": terrain_name,
                    "terrain_description": terrain_description,
                }
                region_id = None
                if region_ids and y < len(region_ids) and x < len(region_ids[y]):
                    region_id = region_ids[y][x]
                if region_id:
                    tile["area"] = region_names.get(region_id) or region_id
                placement = placements_by_pos.get((x, y))
                if placement:
                    entity_id = placement.get("entity_id")
                    if placement.get("type") == "enemy":
                        enemy = enemies_by_id.get(entity_id, {})
                        tile["entity"] = {
                            "type": "enemy",
                            "name": enemy.get("name", entity_id),
                        }
                    elif placement.get("type") == "item":
                        item = items_by_id.get(entity_id, {})
                        tile["entity"] = {
                            "type": "item",
                            "name": item.get("name", entity_id),
                        }
                tiles.append(tile)

        response = await self._quick_completion(
            system_msg=append_language_and_desc_to_prompt(
                SYS_GEN_TILE_QUICK_INFO_MSG + SYS_GENERAL_JSON_RULES_MSG,
                self.language,
                self.theme_desc_better
            ),
            user_msg=json.dumps({"tiles": tiles}, ensure_ascii=False),
            quality=MODEL_QUALITY_FOR_JSON,
        )

        try:
            data = json.loads(extract_clean_data(response))
        except json.JSONDecodeError:
            logger.error("Invalid tile quick-info JSON (%s)", describe_text(response))
            return []

        if not isinstance(data, dict) or not isinstance(data.get("tiles"), list):
            logger.error("Tile quick-info response had unexpected shape (%s)", describe_text(response))
            return []

        return data["tiles"]

    # Generator for generic sentences
    async def gen_adapt_sentence(
            self,
            game_state: GameState,
            event_history: List[dict],
            original_sentence: str
    ) -> str:
        if self.lo_model.client is None:
            return original_sentence

        context = self._create_context(game_state, event_history or [])
        user_msg = f"""Original sentence: {original_sentence}

# Current Game Context
{context}"""

        logger.info("Generating adapted sentence (%s)", describe_text(user_msg))
        if is_sensitive_content_logging_enabled():
            logger.info("gen_adapt_sentence user message: %s", user_msg)

        try:
            async def get_completion():
                return await self.lo_model.client.chat.completions.create(
                    messages=[
                        {"role": "system", "content":
                            append_language_and_desc_to_prompt(
                                ADAPT_SENTENCE_SYSTEM_MSG,
                                self.language,
                                self.theme_desc_better
                          )
                        },
                        {"role": "user", "content": user_msg}
                    ],
                    **self.lo_model.completion_params(),
                )

            response = await with_exponential_backoff(get_completion)
            result = response.choices[0].message.content
            logger.info("Generated adapted description (%s)", describe_text(result))
            if is_sensitive_content_logging_enabled():
                logger.info("Generated adapted description content: %s", result)
            return result

        except Exception as e:
            logger.error(f"Error generating description: {e}")
            return original_sentence

    # Generate a room description based on game state and history.
    async def gen_room_description(self, game_state: GameState, event_history: List[dict]) -> str:
        context = self._create_context(game_state, event_history or [])
        user_msg = f"""Generate a short random location description.

# Current Game Context
{context}
"""
        logger.info("Generating room description (%s)", describe_text(user_msg))
        if is_sensitive_content_logging_enabled():
            logger.info("gen_room_description user message: %s", user_msg)

        try:
            async def get_completion():
                return await self.lo_model.client.chat.completions.create(
                    messages=[
                        {"role": "system", "content":
                            append_language_and_desc_to_prompt(
                                ROOM_DESC_SYSTEM_MSG,
                                self.language,
                                self.theme_desc_better
                            )
                        },
                        {"role": "user", "content": user_msg}
                    ],
                    **self.lo_model.completion_params()
                )

            response = await with_exponential_backoff(get_completion)
            result = response.choices[0].message.content
            logger.info("Generated room description (%s)", describe_text(result))
            if is_sensitive_content_logging_enabled():
                logger.info("Generated room description content: %s", result)
            return result

        except Exception as e:
            logger.error(f"Error generating room description: {e}")
            return "You enter a mysterious location. [FALLBACK]"
