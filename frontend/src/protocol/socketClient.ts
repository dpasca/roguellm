import type { GameAction, GameServerMessage } from './types';
import { getWebSocketUrl } from './session';

export interface GameSocketCallbacks {
  onMessage(message: GameServerMessage): void;
  onOpen?(): void;
  onClose?(event: CloseEvent): void;
  onError?(event: Event): void;
}

export class GameSocketClient {
  private socket: WebSocket | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly callbacks: GameSocketCallbacks
  ) {}

  connect(): void {
    this.socket = new WebSocket(getWebSocketUrl(this.sessionId));

    this.socket.addEventListener('open', () => {
      this.callbacks.onOpen?.();
    });

    this.socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string' || event.data.length === 0) {
        return;
      }

      const message = JSON.parse(event.data) as GameServerMessage;
      this.callbacks.onMessage(message);
    });

    this.socket.addEventListener('close', (event) => {
      this.callbacks.onClose?.(event);
    });

    this.socket.addEventListener('error', (event) => {
      this.callbacks.onError?.(event);
    });
  }

  send(action: GameAction): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(action));
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }
}
