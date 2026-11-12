import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Icon } from '../components/icons'
import { db } from '../db'
import { exerciseLabel } from '../lib/exercises'
import { useOpenSheet } from '../lib/sheets'
import { fmtDate, fmtDuration, fmtInt, fmtSet } from '../lib/format'
import { bestSet, volume, workoutPRCounts } from '../lib/stats'

const PAGE = 30

const count = (n: number) => `${fmtInt(n)} ${n === 1 ? 'entreno' : 'entrenos'}`

export function HistoryPage() {
  const openSheet = useOpenSheet()
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
  const names = useLiveQuery(
    async () => new Map((await db.exercises.toArray()).map((e) => [e.id, exerciseLabel(e)] as const)),
    [],
  )
  // Records per workout, from the whole history.
  const summary = useLiveQuery(async () => {
    const all = (await db.workouts.toArray()).filter((w) => w.endedAt !== null)
    return { total: all.length, prs: workoutPRCounts(all) }
  }, [])

  return (
    <div className="page">
      <header className="page-header">
        <h1>Historial</h1>
        {summary && summary.total > 0 && <span className="muted small-text">{count(summary.total)}</span>}
      </header>

      {workouts?.length === 0 && <p className="empty">Todavía no hay entrenos terminados.</p>}
      {workouts?.map((w) => {
        const prs = summary?.prs.get(w.id) ?? 0
        return (
          <button key={w.id} className="card history-card" onClick={() => openSheet(`/history/${w.id}`)}>
            <span className="history-title">
              <strong>{w.name}</strong>
              {prs > 0 && (
                <span className="pr-badge" aria-label={`${prs} ${prs === 1 ? 'récord' : 'récords'}`}>
                  <Icon name="trophy" size={16} /> {prs}
                </span>
              )}
            </span>
            <span className="muted small-text">
              {fmtDate(w.startedAt)} · {fmtDuration((w.endedAt ?? w.startedAt) - w.startedAt)} · {fmtInt(volume(w))} kg
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
        )
      })}
      {workouts && summary && workouts.length >= limit && limit < summary.total && (
        <button className="btn full" onClick={() => setLimit((l) => l + PAGE)}>
          Ver más
        </button>
      )}
    </div>
  )
}
