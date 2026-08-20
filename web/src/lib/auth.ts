// Shared-secret access key for the API gate. Stored per browser; the server
// ignores it entirely when ACCESS_PASSWORD is not configured.
const STORAGE_KEY = "voice-agents-access-key";

export function getAccessKey(): string {
  return localStorage.getItem(STORAGE_KEY) ?? "";
}

export function setAccessKey(key: string): void {
  localStorage.setItem(STORAGE_KEY, key);
}

/** Headers for fetch requests. */
export function authHeaders(): Record<string, string> {
  const key = getAccessKey();
  return key ? { "x-access-key": key } : {};
}

/** Append the key to a WebSocket URL (browsers can't set WS headers). */
export function withAccessKey(url: string): string {
  const key = getAccessKey();
  if (!key) return url;
  return `${url}${url.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}`;
}
