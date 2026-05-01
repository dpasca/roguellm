export function getSessionIdFromLocation(pathname = window.location.pathname): string | null {
  const parts = pathname.split('/').filter(Boolean);
  const routeIndex = parts.findIndex((part) => part === 'game2' || part === 'game');

  if (routeIndex >= 0 && parts[routeIndex + 1]) {
    return parts[routeIndex + 1];
  }

  return new URLSearchParams(window.location.search).get('session_id');
}

export function getBackendOrigin(): string {
  const configured = import.meta.env.VITE_BACKEND_ORIGIN;
  if (configured) {
    return configured.replace(/\/$/, '');
  }

  if (window.location.port === '5173') {
    return 'http://127.0.0.1:8000';
  }

  return window.location.origin;
}

export function getWebSocketUrl(sessionId: string): string {
  const backend = new URL(getBackendOrigin());
  backend.protocol = backend.protocol === 'https:' ? 'wss:' : 'ws:';
  backend.pathname = `/ws/game/${sessionId}`;
  backend.search = '';
  backend.hash = '';
  return backend.toString();
}
