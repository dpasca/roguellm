#!/usr/bin/env python3
"""
Test script to verify WebSocket updates work when pixel art is ready.
"""

import asyncio
import websockets
import json
import logging

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s: %(message)s'
)
logger = logging.getLogger()

async def test_websocket_pixel_art_updates():
    """Test WebSocket connection and pixel art updates."""

    print("=== WebSocket Pixel Art Updates Test ===")

    # Connect to WebSocket (use a dummy session ID - the server will create the game)
    uri = "ws://127.0.0.1:8000/ws/game/test-session-123"

    try:
        async with websockets.connect(uri) as websocket:
            print("Connected to WebSocket")

            # Listen for messages
            message_count = 0
            pixel_art_received = False

            async for message in websocket:
                try:
                    data = json.loads(message)
                    message_count += 1

                    print(f"\n--- Message {message_count} ---")
                    print(f"Type: {data.get('type', 'unknown')}")

                    if data.get('type') == 'status':
                        print(f"Status: {data.get('status', 'unknown')}")
                        print(f"Message: {data.get('message', 'No message')}")

                    elif data.get('type') == 'update' and data.get('state'):
                        print("Received state update!")
                        state = data['state']

                        # Check if we have pixel art in the state
                        pixel_art_count = 0

                        # Check enemies
                        if 'enemies' in state:
                            for enemy in state['enemies']:
                                if 'pixel_art_data_url' in enemy:
                                    pixel_art_count += 1

                        # Check items
                        if 'items' in state:
                            for item in state['items']:
                                if 'pixel_art_data_url' in item:
                                    pixel_art_count += 1

                        # Check cell types
                        if 'cell_types' in state and state['cell_types']:
                            for row in state['cell_types']:
                                for cell in row:
                                    if isinstance(cell, dict) and 'pixel_art_data_url' in cell:
                                        pixel_art_count += 1

                        # Check player
                        if 'player' in state and 'pixel_art_data_url' in state['player']:
                            pixel_art_count += 1

                        print(f"Entities with pixel art: {pixel_art_count}")

                        if pixel_art_count > 0:
                            pixel_art_received = True
                            print("🎨 PIXEL ART RECEIVED!")

                            # Show description if this was the pixel art update
                            if data.get('description'):
                                print(f"Description: {data['description']}")

                    elif data.get('type') == 'error':
                        print(f"Error: {data.get('message', 'Unknown error')}")
                        break

                    # Stop after receiving pixel art or after 10 messages
                    if pixel_art_received or message_count >= 10:
                        break

                except json.JSONDecodeError:
                    print(f"Invalid JSON received: {message}")
                except Exception as e:
                    print(f"Error processing message: {e}")

            print(f"\n=== Test Summary ===")
            print(f"Messages received: {message_count}")
            print(f"Pixel art received: {'✅ YES' if pixel_art_received else '❌ NO'}")

            return pixel_art_received

    except websockets.exceptions.ConnectionClosed:
        print("WebSocket connection closed")
        return False
    except Exception as e:
        print(f"Error connecting to WebSocket: {e}")
        return False

async def main():
    """Run the WebSocket test."""
    print("Testing WebSocket pixel art updates...\n")

    success = await test_websocket_pixel_art_updates()

    print(f"\n=== Final Result ===")
    if success:
        print("✅ WebSocket pixel art updates test PASSED")
        return True
    else:
        print("❌ WebSocket pixel art updates test FAILED")
        return False

if __name__ == "__main__":
    success = asyncio.run(main())
    exit(0 if success else 1)