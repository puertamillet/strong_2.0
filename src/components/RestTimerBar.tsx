import { useEffect, useState } from 'react'
import { fmtClock } from '../lib/format'
import { REST_STEP, restTimer, signalRestOver, useRestTimer } from '../lib/restTimer'

export function RestTimerBar() {
  const timer = useRestTimer()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!timer) return
    const t = setInterval(() => {
      const n = Date.now()
      setNow(n)
      if (n >= timer.endsAt) {
        restTimer.stop()
        // Don't beep late when coming back to the app long after the rest ended.
        if (document.visibilityState === 'visible' && n - timer.endsAt < 2000) signalRestOver()
      }
    }, 250)
    return () => clearInterval(t)
  }, [timer])

  if (!timer) return null
  const remaining = (timer.endsAt - now) / 1000
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
      <button className="rest-btn skip" onClick={() => restTimer.stop()}>
        Saltar
      </button>
    </div>
  )
}
