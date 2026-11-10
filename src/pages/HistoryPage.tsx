import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ColumnChart } from '../components/charts'
import { Icon } from '../components/icons'
import { db } from '../db'
import { fmtDate, fmtDuration, fmtInt, fmtSet, fmtShortDate } from '../lib/format'
import { bestSet, volume, weeklyCounts, weekStart, workoutPRCounts } from '../lib/stats'

const PAGE = 30
const WEEKS = 12

export function HistoryPage() {
  const navigate = useNavigate()
  const [limit, setLimit] = useState(PAGE)
  const [now] = useState(Date.now)
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
    async () => new Map((await db.exercises.toArray()).map((e) => [e.id, e.name] as const)),
    [],
  )
  // Whole-history figures: records per workout, weekly frequency and totals.
  const summary = useLiveQuery(async () => {
    const all = (await db.workouts.toArray()).filter((w) => w.endedAt !== null)
    const thisWeek = weekStart(now)
    const d = new Date(now)
    const thisMonth = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
    return {
      total: all.length,
      week: all.filter((w) => w.startedAt >= thisWeek).length,
      month: all.filter((w) => w.startedAt >= thisMonth).length,
      weekly: weeklyCounts(all, WEEKS, now),
      prs: workoutPRCounts(all),
    }
  }, [now])

  const weekly = summary?.weekly ?? []
  const avg = weekly.length ? weekly.slice(0, -1).reduce((s, w) => s + w.count, 0) / Math.max(1, weekly.length - 1) : 0

  return (
    <div className="page">
      <header className="page-header">
        <h1>Historial</h1>
      </header>

      {summary && summary.total > 0 && (
        <>
          <div className="stat-row">
            <div className="card stat">
              <span className="stat-label">Esta semana</span>
              <span className="stat-value">{summary.week}</span>
            </div>
            <div className="card stat">
              <span className="stat-label">Este mes</span>
              <span className="stat-value">{summary.month}</span>
            </div>
            <div className="card stat">
              <span className="stat-label">Total</span>
              <span className="stat-value">{fmtInt(summary.total)}</span>
            </div>
          </div>
          <section className="card chart-card">
            <div className="chart-head">
              <h2>Entrenos por semana</h2>
              <span className="muted small-text">Media: {avg.toLocaleString('es-ES', { maximumFractionDigits: 1 })}</span>
            </div>
            <ColumnChart
              label={`Entrenos por semana en las últimas ${WEEKS} semanas`}
              data={weekly.map((w, i) => ({
                key: w.week,
                value: w.count,
                axis: i === weekly.length - 1 ? 'Esta semana' : fmtShortDate(w.week),
                description: `${i === weekly.length - 1 ? 'Esta semana' : `Semana del ${fmtShortDate(w.week)}`}: ${w.count} ${w.count === 1 ? 'entreno' : 'entrenos'}`,
              }))}
            />
            <details className="table-view">
              <summary>Ver datos</summary>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Semana</th>
                    <th className="num">Entrenos</th>
                  </tr>
                </thead>
                <tbody>
                  {[...weekly].reverse().map((w) => (
                    <tr key={w.week}>
                      <td>{fmtShortDate(w.week)}</td>
                      <td className="num">{w.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </section>
        </>
      )}

      {workouts?.length === 0 && <p className="empty">Todavía no hay entrenos terminados.</p>}
      {workouts?.map((w) => {
        const prs = summary?.prs.get(w.id) ?? 0
        return (
          <button key={w.id} className="card history-card" onClick={() => navigate(`/workout/${w.id}`)}>
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
