import { fmtClock } from '../lib/format'
import { REST_STEP, restTimer, useRestTimer } from '../lib/restTimer'
import { useNow } from '../lib/useNow'

/** The running rest: time left, −/+ and skip. The ping at the end is played by useRestAlarm, or on skipping it. */
export function RestTimerBar() {
  const timer = useRestTimer()
  const now = useNow(250, timer !== null)
  if (!timer) return null
  const remaining = Math.max(0, (timer.endsAt - now) / 1000)
  const progress = Math.min(1, Math.max(0, 1 - remaining / timer.total))

  return (
    <div className="rest-bar" role="timer" aria-label="Descanso">
      <div className="rest-progress" style={{ width: `${progress * 100}%` }} />
      <button className="rest-btn" aria-label={`Quitar ${REST_STEP} segundos`} onClick={() => restTimer.adjust(-REST_STEP)}>
        −{REST_STEP}
      </button>
      <div className="rest-time">
        <small>Descanso</small>
        <strong>{fmtClock(remaining)}</strong>
      </div>
      <button className="rest-btn" aria-label={`Añadir ${REST_STEP} segundos`} onClick={() => restTimer.adjust(REST_STEP)}>
        +{REST_STEP}
      </button>
      <button className="rest-btn skip" onClick={() => restTimer.skip()}>
        Saltar
      </button>
    </div>
  )
}
