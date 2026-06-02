import type { ClientMessage, ServerMessage } from '../shared/protocol';

type MessageHandler = (message: ServerMessage) => void;
type StatusHandler = (status: 'offline' | 'connecting' | 'online') => void;

export class NetworkClient {
  private socket?: WebSocket;
  private messageHandlers: MessageHandler[] = [];
  private statusHandlers: StatusHandler[] = [];
  private status: 'offline' | 'connecting' | 'online' = 'offline';

  connect(): Promise<void> {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return Promise.resolve();
    }

    this.setStatus('connecting');
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(getWebSocketUrl());
      this.socket = socket;

      socket.addEventListener('open', () => {
        this.setStatus('online');
        resolve();
      });
      socket.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(String(event.data)) as ServerMessage;
          this.messageHandlers.forEach((handler) => handler(message));
        } catch {
          // Ignore malformed server data; the next valid state update will recover the UI.
        }
      });
      socket.addEventListener('close', () => {
        this.setStatus('offline');
      });
      socket.addEventListener('error', () => {
        this.setStatus('offline');
        reject(new Error('Could not connect to the multiplayer server.'));
      });
    });
  }

  send(message: ClientMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  onStatus(handler: StatusHandler): void {
    this.statusHandlers.push(handler);
    handler(this.status);
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = undefined;
    this.setStatus('offline');
  }

  private setStatus(status: 'offline' | 'connecting' | 'online'): void {
    if (this.status === status) {
      return;
    }
    this.status = status;
    this.statusHandlers.forEach((handler) => handler(status));
  }
}

function getWebSocketUrl(): string {
  const customUrl = localStorage.getItem('yardline-custom-ws-url');
  if (customUrl) {
    return customUrl;
  }
  const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
  if (envUrl) {
    return envUrl;
  }
  if (import.meta.env.DEV) {
    return 'ws://localhost:8787/ws';
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}
