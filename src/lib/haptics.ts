/**
 * A short tap of the phone's vibration motor when a tap changes the workout: ticking a set, adding
 * or deleting one. iOS has no Vibration API for web apps, but since iOS 18 Safari gives the same
 * haptic tick as the system switches when an `<input type="checkbox" switch>` is toggled, also from
 * code while handling a tap; so a hidden one is toggled (one tick, whatever the pattern). Elsewhere
 * the Vibration API is used (Android), with `pattern` (ms). Where neither works it does nothing.
 */
let toggle: HTMLLabelElement | null = null

export function haptic(pattern: number | number[] = 10): void {
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
