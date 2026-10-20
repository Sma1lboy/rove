/**
 * The bridge token. `rove --web` prints `http://host/#token=…`; the fragment
 * never reaches a server, and this module moves it into storage and off the
 * address bar at import time. `main.tsx` imports it first so nothing else
 * (history, extensions reading the URL) sees it.
 */

const STORAGE_KEY = "rove.bridge.token"

const fromLink = new URLSearchParams(window.location.hash.slice(1)).get("token")
if (fromLink) {
  localStorage.setItem(STORAGE_KEY, fromLink)
  history.replaceState(null, "", window.location.pathname + window.location.search)
}

export function storedToken(): string | null {
  return localStorage.getItem(STORAGE_KEY)
}

export function saveToken(token: string): void {
  localStorage.setItem(STORAGE_KEY, token)
}

export function forgetToken(): void {
  localStorage.removeItem(STORAGE_KEY)
}
