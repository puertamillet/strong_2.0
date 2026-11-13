import { Capacitor, registerPlugin } from '@capacitor/core'

/**
 * The iPhone app (ios/, made with Capacitor) is this same web app inside a native shell, with native
 * plugins for what a web app can't do on an iPhone: local notifications (lib/localNotifications),
 * vibration (lib/haptics), saving files (lib/backup) and the app's own plugin, StrongNative, for the
 * ping, with the app on screen or not, the rest on the lock screen and keeping the screen on. In the browser and in the web app on the home screen this is
 * false, and nothing native is used.
 */
export const isNativeApp = Capacitor.isNativePlatform()

/** The app's own plugin: native/strong-native. */
export interface StrongNativePlugin {
  /**
   * Plays the end-of-rest ping (sounds/ping.wav, see lib/ping): also with the iPhone in silent mode,
   * and over the podcast or the music, which only get lower for a moment (they aren't paused).
   */
  ping(): Promise<void>
  /**
   * Rings the ping when the rest ends, at `endsAt` (null: no rest now), if the app isn't on screen
   * then: with the iPhone locked or in another app, also in silent mode, and lowering the podcast or
   * the music for a moment, as ping does. The rest notification still shows, without its sound.
   * With the app on screen it does nothing: the app rings by itself (useRestAlarm).
   */
  ringAt(options: { endsAt: number | null }): Promise<void>
  /**
   * Shows the rest on the lock screen and in the Dynamic Island (a Live Activity, iOS 16.2+), from
   * `startedAt` to `endsAt`, with the next set: its exercise, and `detail` ("60 kg × 8 · serie 2
   * de 3"). With `endsAt` null it goes away. See lib/liveActivity.
   */
  restActivity(
    options: { startedAt: number; endsAt: number; exercise: string | null; detail: string | null } | { endsAt: null },
  ): Promise<void>
  /** Keeps the screen on (`on: true`), or lets the iPhone lock by itself again. */
  keepAwake(options: { on: boolean }): Promise<void>
}

export const StrongNative = registerPlugin<StrongNativePlugin>('StrongNative')

/** The native plugins the app uses (package.json). */
const PLUGINS = ['StrongNative', 'LocalNotifications', 'Haptics', 'Filesystem', 'Share', 'App']

/**
 * A plugin missing from the iPhone app is a mistake in its build: it is said in the console, where
 * the iOS workflow looks for errors when it runs the app in the simulator.
 */
export function checkNativePlugins(): void {
  if (!isNativeApp) return
  const missing = PLUGINS.filter((name) => !Capacitor.isPluginAvailable(name))
  if (missing.length) console.error(`Faltan plugins nativos en la app: ${missing.join(', ')}`)
}
