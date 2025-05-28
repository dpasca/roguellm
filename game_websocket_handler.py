import logging
from typing import Dict, Any
from websocket_schemas import validate_websocket_message, ValidationError

logger = logging.getLogger()


class WebSocketHandler:
    """Handles WebSocket message validation, routing, and response formatting."""

    def __init__(self, game_state_manager, player_action_handler):
        self.game_state_manager = game_state_manager
        self.player_action_handler = player_action_handler
        self.connected_clients = set()

    async def handle_message(self, message: dict) -> dict:
        """
        Handle incoming WebSocket messages with validation.

        Args:
            message: Raw message dictionary from WebSocket

        Returns:
            dict: Response message
        """
        try:
            # Validate the incoming message
            validated_message = validate_websocket_message(message)
            action = validated_message.action.value

            logger.debug(f"Processing validated message: action={action}")

        except ValidationError as e:
            logger.warning(f"Invalid WebSocket message: {e.message}")
            if e.details:
                logger.debug(f"Validation error details: {e.details}")

            # Return structured error response
            return await self.game_state_manager.create_message(
                description_raw=f"Invalid message: {e.message}",
                description=f"Invalid message: {e.message}"
            )
        except Exception as e:
            logger.error(f"Unexpected error validating message: {e}")
            return await self.game_state_manager.create_message(
                description_raw="Invalid message format",
                description="Invalid message format"
            )

        # Route the validated message to appropriate handler
        return await self._route_message(action, validated_message)

    async def _route_message(self, action: str, validated_message) -> dict:
        """Route validated messages to appropriate handlers."""

        # Initialize game if state doesn't exist yet
        if not hasattr(self.game_state_manager, 'state') or self.game_state_manager.state is None:
            try:
                initial_message = await self.game_state_manager.initialize_game()
                # For get_initial_state, return the initialization message with description
                if action == 'get_initial_state':
                    result = await self.game_state_manager.create_message_description(initial_message)
                    self.game_state_manager.events_add('initialize', result)
                    return result
                return initial_message
            except Exception as e:
                logger.error(f"Failed to initialize game: {e}")
                return {
                    'type': 'error',
                    'message': f'Failed to initialize game: {str(e)}'
                }

        # Handle get_initial_state - return current state with room description
        if action == 'get_initial_state':
            # If this is the first time getting initial state, generate a room description
            if not self.game_state_manager.event_history:
                room_description = await self.game_state_manager._gen_room_description()
                result = await self.game_state_manager.create_message(room_description)
                result = await self.game_state_manager.create_message_description(result)
                self.game_state_manager.events_add('initialize', result)
                return result
            else:
                # Return current state without adding new events
                return await self.game_state_manager.create_message("")

        # Handle initialize action - reinitialize the game
        if action == 'initialize':
            return await self.game_state_manager.create_message_description(
                await self.game_state_manager.initialize_game()
            )

        if action == 'restart':
            self.game_state_manager.events_reset()
            return await self.game_state_manager.create_message_description(
                await self.game_state_manager.initialize_game()
            )

        # Check game over and win states before processing any other action
        if self.game_state_manager.state.game_over:
            result = await self.game_state_manager.create_message("Game Over! Press Restart to play again.")
            result = await self.game_state_manager.create_message_description(result)
            self.game_state_manager.events_add('game_over', result)
            return result

        if self.game_state_manager.state.game_won:
            result = await self.game_state_manager.create_message("Congratulations! You have won the game! Press Restart to play again.")
            result = await self.game_state_manager.create_message_description(result)
            self.game_state_manager.events_add('game_won', result)
            return result

        # Route to player action handler
        result = await self._handle_player_action(action, validated_message)

        # Create a generic message if result is still None
        if result is None:
            desc = f"Unknown action: {action}"
            result = await self.game_state_manager.create_message(description=desc, description_raw=desc)

        # Skip adding the event if the description is empty
        if result.get('description_raw') == "":
            return result

        # Create or fill 'description' field if not already present or if empty
        result = await self.game_state_manager.create_message_description(result)
        self.game_state_manager.events_add(action, result)  # Record the event
        return result

    async def _handle_player_action(self, action: str, validated_message) -> dict:
        """Handle player actions by delegating to the player action handler."""

        if action == 'move' and not self.game_state_manager.state.in_combat:
            return await self.player_action_handler.handle_move(validated_message.direction.value)
        elif action == 'attack' and self.game_state_manager.state.in_combat:
            return await self.player_action_handler.handle_combat_action('attack')
        elif action == 'run' and self.game_state_manager.state.in_combat:
            return await self.player_action_handler.handle_combat_action('run')
        elif action == 'use_item':
            return await self.player_action_handler.handle_use_item(validated_message.item_id)
        elif action == 'equip_item':
            return await self.player_action_handler.handle_equip_item(validated_message.item_id)
        elif action == 'initialize':
            return await self.game_state_manager.initialize_game()
        elif action == 'get_initial_state':
            # This is used just to get the map initialized
            return await self.game_state_manager.create_message("")

        return None

    def add_client(self, client):
        """Add a WebSocket client connection."""
        self.connected_clients.add(client)

    def remove_client(self, client):
        """Remove a WebSocket client connection."""
        self.connected_clients.discard(client)

    def get_connected_clients(self):
        """Get the set of connected clients."""
        return self.connected_clients.copy()