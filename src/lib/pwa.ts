import { registerSW } from 'virtual:pwa-register'

const HOUR = 60 * 60 * 1000

/**
 * Registers the service worker and keeps the app up to date. With registerType
 * 'autoUpdate' the page reloads by itself as soon as a new version is installed.
 * iOS keeps home-screen apps alive in the background instead of opening them again,
 * so also look for a new version whenever the app comes back to the front, and
 * every hour while it stays open.
 */
export function keepAppUpdated(): void {
  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return
      const check = () => {
        if (navigator.onLine && !registration.installing) void registration.update().catch(() => {})
      }
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
      setInterval(check, HOUR)
    },
  })
}
