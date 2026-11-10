import { useLiveQuery } from 'dexie-react-hooks'
import { useLocation } from 'react-router-dom'
import { fmtClock } from '../lib/format'
import { useRestTimer } from '../lib/restTimer'
import { useOpenSheet } from '../lib/sheets'
import { useNow } from '../lib/useNow'
import { getActiveWorkout } from '../lib/workouts'
import { Icon } from './icons'

/** The minimised workout, above the tab bar: name, time and the rest left. Tap to open it again. */
export function WorkoutBar() {
  const active = useLiveQuery(() => getActiveWorkout().then((w) => w ?? null), [])
  const { pathname } = useLocation()
  const openSheet = useOpenSheet()
  const timer = useRestTimer()
  const now = useNow(1000, Boolean(active))
  if (!active || pathname === `/workout/${active.id}`) return null
  const rest = timer ? Math.max(0, (timer.endsAt - now) / 1000) : null

  return (
    <button className="workout-bar" onClick={() => openSheet(`/workout/${active.id}`)} aria-label={`Abrir el entreno en curso, ${active.name}`}>
      <span className="workout-bar-text">
        <strong>{active.name}</strong>
        <span className="muted">{fmtClock((now - active.startedAt) / 1000)}</span>
      </span>
      {rest !== null && (
        <span className="workout-bar-rest" aria-label={`Descanso: ${fmtClock(rest)}`}>
          <Icon name="timer" size={16} />
          {fmtClock(rest)}
        </span>
      )}
      <Icon name="chevronUp" size={22} />
    </button>
  )
}
