"""
WebSocket Message Validation Schemas

This module defines Pydantic models for validating incoming WebSocket messages
to ensure data integrity and prevent malformed input from causing crashes.
"""

from pydantic import BaseModel, Field, validator
from typing import Optional, Literal, Union
from enum import Enum


class ActionType(str, Enum):
    """Valid action types for WebSocket messages"""
    INITIALIZE = "initialize"
    GET_INITIAL_STATE = "get_initial_state"
    RESTART = "restart"
    MOVE = "move"
    ATTACK = "attack"
    RUN = "run"
    USE_ITEM = "use_item"
    EQUIP_ITEM = "equip_item"


class Direction(str, Enum):
    """Valid movement directions"""
    NORTH = "n"
    SOUTH = "s"
    EAST = "e"
    WEST = "w"


class BaseMessage(BaseModel):
    """Base WebSocket message with common fields"""
    action: ActionType = Field(..., description="The action to perform")

    class Config:
        # Allow extra fields for future extensibility, but validate known ones
        extra = "forbid"


class InitializeMessage(BaseMessage):
    """Message for initializing the game"""
    action: Literal[ActionType.INITIALIZE] = ActionType.INITIALIZE


class GetInitialStateMessage(BaseMessage):
    """Message for getting initial game state"""
    action: Literal[ActionType.GET_INITIAL_STATE] = ActionType.GET_INITIAL_STATE


class RestartMessage(BaseMessage):
    """Message for restarting the game"""
    action: Literal[ActionType.RESTART] = ActionType.RESTART


class MoveMessage(BaseMessage):
    """Message for player movement"""
    action: Literal[ActionType.MOVE] = ActionType.MOVE
    direction: Direction = Field(..., description="Direction to move")


class AttackMessage(BaseMessage):
    """Message for combat attack action"""
    action: Literal[ActionType.ATTACK] = ActionType.ATTACK


class RunMessage(BaseMessage):
    """Message for running from combat"""
    action: Literal[ActionType.RUN] = ActionType.RUN


class UseItemMessage(BaseMessage):
    """Message for using an item"""
    action: Literal[ActionType.USE_ITEM] = ActionType.USE_ITEM
    item_id: str = Field(..., min_length=1, max_length=100, description="ID of the item to use")

    @validator('item_id')
    def validate_item_id(cls, v):
        """Validate item ID format"""
        if not v or not v.strip():
            raise ValueError("Item ID cannot be empty")
        # Basic sanitization - remove any potentially dangerous characters
        if any(char in v for char in ['<', '>', '"', "'", '&', '\n', '\r', '\t']):
            raise ValueError("Item ID contains invalid characters")
        return v.strip()


class EquipItemMessage(BaseMessage):
    """Message for equipping an item"""
    action: Literal[ActionType.EQUIP_ITEM] = ActionType.EQUIP_ITEM
    item_id: str = Field(..., min_length=1, max_length=100, description="ID of the item to equip")

    @validator('item_id')
    def validate_item_id(cls, v):
        """Validate item ID format"""
        if not v or not v.strip():
            raise ValueError("Item ID cannot be empty")
        # Basic sanitization - remove any potentially dangerous characters
        if any(char in v for char in ['<', '>', '"', "'", '&', '\n', '\r', '\t']):
            raise ValueError("Item ID contains invalid characters")
        return v.strip()


# Union type for all possible message types
WebSocketMessage = Union[
    InitializeMessage,
    GetInitialStateMessage,
    RestartMessage,
    MoveMessage,
    AttackMessage,
    RunMessage,
    UseItemMessage,
    EquipItemMessage
]


class ValidationError(Exception):
    """Custom exception for message validation errors"""
    def __init__(self, message: str, details: Optional[dict] = None):
        self.message = message
        self.details = details or {}
        super().__init__(self.message)


def validate_websocket_message(raw_message: dict) -> WebSocketMessage:
    """
    Validate and parse a raw WebSocket message into a typed message object.

    Args:
        raw_message: Raw dictionary from WebSocket

    Returns:
        Validated message object

    Raises:
        ValidationError: If message is invalid
    """
    try:
        # First check if we have an action field
        if not isinstance(raw_message, dict):
            raise ValidationError("Message must be a JSON object")

        action = raw_message.get('action')
        if not action:
            raise ValidationError("Missing required field 'action'")

        # Validate action type
        try:
            action_enum = ActionType(action)
        except ValueError:
            valid_actions = [e.value for e in ActionType]
            raise ValidationError(
                f"Invalid action '{action}'. Valid actions are: {valid_actions}",
                {"invalid_action": action, "valid_actions": valid_actions}
            )

        # Route to appropriate message type based on action
        message_classes = {
            ActionType.INITIALIZE: InitializeMessage,
            ActionType.GET_INITIAL_STATE: GetInitialStateMessage,
            ActionType.RESTART: RestartMessage,
            ActionType.MOVE: MoveMessage,
            ActionType.ATTACK: AttackMessage,
            ActionType.RUN: RunMessage,
            ActionType.USE_ITEM: UseItemMessage,
            ActionType.EQUIP_ITEM: EquipItemMessage,
        }

        message_class = message_classes[action_enum]

        # Validate the message using the appropriate Pydantic model
        try:
            return message_class(**raw_message)
        except Exception as e:
            # Convert Pydantic validation errors to our custom format
            error_details = {}
            if hasattr(e, 'errors'):
                error_details = {"validation_errors": e.errors()}
            raise ValidationError(
                f"Invalid message format for action '{action}': {str(e)}",
                error_details
            )

    except ValidationError:
        # Re-raise our custom validation errors
        raise
    except Exception as e:
        # Catch any other unexpected errors
        raise ValidationError(f"Unexpected error validating message: {str(e)}")