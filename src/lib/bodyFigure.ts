import { useSyncExternalStore } from 'react'
import type { FigureSex } from '../data/bodyFigure'

/** Which body the exercise page shows the muscles on: a setting of this device, male by default. */
const KEY = 'strong2.bodyFigure'
const listeners = new Set<() => void>()
let sex = readSetting()

function readSetting(): FigureSex {
  try {
    return localStorage.getItem(KEY) === 'female' ? 'female' : 'male'
  } catch {
    return 'male'
  }
}

export function setBodyFigure(next: FigureSex): void {
  sex = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // Storage unavailable; the setting lasts until the app closes.
  }
  listeners.forEach((l) => l())
}

export function useBodyFigure(): FigureSex {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => sex,
  )
}
