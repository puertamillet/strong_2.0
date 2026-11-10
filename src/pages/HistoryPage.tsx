import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../db'
import { fmtDate, fmtDuration, fmtNumber, fmtSet } from '../lib/format'
import { bestSet, volume } from '../lib/stats'

const PAGE = 30

export function HistoryPage() {
  const navigate = useNavigate()
  const [limit, setLimit] = useState(PAGE)
  const workouts = useLiveQuery(
    () =>
      db.workouts
        .orderBy('startedAt')
        .reverse()
        .filter((w) => w.endedAt !== null)
        .limit(limit)
        .toArray(),
    [limit],
  )
  const total = useLiveQuery(() => db.workouts.count(), [])
  const names = useLiveQuery(
    async () => new Map((await db.exercises.toArray()).map((e) => [e.id, e.name] as const)),
    [],
  )

  return (
    <div className="page">
      <header className="page-header">
        <h1>Historial</h1>
      </header>
      {workouts?.length === 0 && <p className="empty">Todavía no hay entrenos terminados.</p>}
      {workouts?.map((w) => (
        <button key={w.id} className="card history-card" onClick={() => navigate(`/workout/${w.id}`)}>
          <strong>{w.name}</strong>
          <span className="muted small-text">
            {fmtDate(w.startedAt)} · {fmtDuration((w.endedAt ?? w.startedAt) - w.startedAt)} ·{' '}
            {fmtNumber(Math.round(volume(w)))} kg
          </span>
          <ul className="history-exercises">
            {w.exercises.map((e, i) => {
              const best = bestSet(e.sets)
              return (
                <li key={i}>
                  <span>
                    {e.sets.length} × {names?.get(e.exerciseId) ?? '?'}
                  </span>
                  <span className="muted">{best ? fmtSet(best) : ''}</span>
                </li>
              )
            })}
          </ul>
        </button>
      ))}
      {workouts && total !== undefined && workouts.length >= limit && limit < total && (
        <button className="btn full" onClick={() => setLimit((l) => l + PAGE)}>
          Ver más
        </button>
      )}
    </div>
  )
}
