import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { isNativeApp } from './native'

/**
 * A short tap of the phone's vibration motor when a tap changes the workout: ticking a set, adding
 * or deleting one. iOS has no Vibration API for web apps, but since iOS 18 Safari gives the same
 * haptic tick as the system switches when an `<input type="checkbox" switch>` is toggled, also from
 * code while handling a tap; so a hidden one is toggled (one tick, whatever the pattern). Elsewhere
 * the Vibration API is used (Android), with `pattern` (ms). Where neither works it does nothing.
 * The iPhone app vibrates natively (nativeHaptic).
 */
let toggle: HTMLLabelElement | null = null

export function haptic(pattern: number | number[] = 10): void {
  if (isNativeApp) {
    nativeHaptic(pattern)
    return
  }
  try {
    if (typeof navigator.vibrate === 'function' && navigator.vibrate(pattern)) return
  } catch {
    // No Vibration API: try the switch.
  }
  try {
    if (!toggle) {
      toggle = document.createElement('label')
      toggle.setAttribute('aria-hidden', 'true')
      toggle.style.display = 'none'
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.setAttribute('switch', '')
      input.tabIndex = -1
      toggle.append(input)
      document.body.append(toggle)
    }
    toggle.click()
  } catch {
    // Not available.
  }
}

/**
 * The iPhone app: a light tap for a short pattern (a tick, like the web app's switch), and the
 * vibration motor for a long one, on and off as the pattern says (ms): [200, 100, 200] is two buzzes.
 */
function nativeHaptic(pattern: number | number[]): void {
  const steps = Array.isArray(pattern) ? pattern : [pattern]
  if (steps.every((ms) => ms < 50)) {
    void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {})
    return
  }
  let at = 0
  steps.forEach((ms, i) => {
    if (i % 2 === 0) setTimeout(() => void Haptics.vibrate({ duration: ms }).catch(() => {}), at)
    at += ms
  })
}
