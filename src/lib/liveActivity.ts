import { liveQuery, type Subscription } from 'dexie'
import { nextSet, type NextSet } from './localNotifications'
import { isNativeApp, StrongNative } from './native'

/**
 * The rest on the iPhone's lock screen and in the Dynamic Island, as a Live Activity (iPhone app
 * only, iOS 16.2+): a countdown, a bar that empties and the next set, which follows the workout
 * while the rest runs (ticking a set, changing the next one's weight). When the rest is over it says
 * so, and stays with the next set until the next rest takes its place or the workout ends.
 * StrongNative.restActivity shows it.
 */

let watching: Subscription | null = null

/** "60 kg × 8 · serie 2 de 3" */
function detail(next: NextSet): string {
  return [next.load, `serie ${next.number} de ${next.count}`].filter(Boolean).join(' · ')
}

/** Shows the rest (its end, and how long it is in seconds), or takes it away (null). */
export function showRest(rest: { endsAt: number; total: number } | null): void {
  if (!isNativeApp) return
  watching?.unsubscribe()
  watching = null
  if (!rest) {
    void StrongNative.restActivity({ endsAt: null }).catch(() => {})
    return
  }
  const { endsAt, total } = rest
  let shown = ''
  const show = (next: NextSet | null) => {
    const options = {
      startedAt: endsAt - total * 1000,
      endsAt,
      exercise: next?.exercise ?? null,
      detail: next ? detail(next) : null,
    }
    // The workout changes often (every set ticked), the next set not so often.
    const key = JSON.stringify(options)
    if (key === shown) return
    shown = key
    void StrongNative.restActivity(options).catch(() => {})
  }
  watching = liveQuery(nextSet).subscribe({ next: show, error: () => show(null) })
}
