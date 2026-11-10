import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { LineChart } from '../components/charts'
import { ExerciseSheet } from '../components/ExerciseSheet'
import { db } from '../db'
import { fmtDate, fmtInt, fmtMediumDate, fmtNumber, fmtSet, fmtShortDate, setLabels } from '../lib/format'
import { exerciseSessions, personalRecords, type PersonalRecord, type Records, type Session } from '../lib/stats'
import { estimated1RM } from '../lib/workouts'

type Tab = 'charts' | 'records' | 'history'
type MetricKey = 'e1rm' | 'weight' | 'volume' | 'reps'

const kg = (v: number) => `${fmtNumber(Math.round(v * 10) / 10)} kg`

const METRICS: Record<MetricKey, { label: string; short: string; get: (s: Session) => number; fmt: (v: number) => string }> = {
  e1rm: { label: '1RM estimado', short: '1RM', get: (s) => s.e1rm, fmt: kg },
  weight: { label: 'Peso máximo', short: 'Peso', get: (s) => s.maxWeight, fmt: kg },
  volume: { label: 'Volumen por sesión', short: 'Volumen', get: (s) => s.volume, fmt: (v) => `${fmtInt(v)} kg` },
  reps: { label: 'Repeticiones máximas', short: 'Reps', get: (s) => s.maxReps, fmt: (v) => `${fmtInt(v)} reps` },
}

const RANGES = [
  { key: '3m', label: '3 meses', days: 91 },
  { key: '1y', label: '1 año', days: 365 },
  { key: 'all', label: 'Todo', days: Infinity },
] as const

const DAY = 86_400_000
const monthYear = new Intl.DateTimeFormat('es-ES', { month: 'short', year: '2-digit' })

export function ExerciseDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const exercise = useLiveQuery(() => db.exercises.get(id).then((e) => e ?? null), [id])
  const sessions = useLiveQuery(
    async () => exerciseSessions(await db.workouts.where('exerciseIds').equals(id).toArray(), id),
    [id],
  )
  const [tab, setTab] = useState<Tab>('charts')
  const [editing, setEditing] = useState(false)

  if (exercise === undefined || !sessions) return <div className="page" />
  if (exercise === null) {
    return (
      <div className="page">
        <p className="empty">Este ejercicio ya no existe.</p>
        <button className="btn" onClick={() => navigate('/exercises')}>
          Volver
        </button>
      </div>
    )
  }

  return (
    <div className="page">
      <header className="page-header sticky">
        <button className="link" onClick={() => navigate(-1)}>
          ‹ Atrás
        </button>
        <button className="link strong" onClick={() => setEditing(true)}>
          Editar
        </button>
      </header>
      <div>
        <h1 className="detail-title">{exercise.name}</h1>
        <p className="muted small-text detail-subtitle">
          {exercise.category ?? 'Otros'} · {sessions.length} {sessions.length === 1 ? 'sesión' : 'sesiones'}
        </p>
      </div>

      <div className="segmented" role="group" aria-label="Sección">
        {(
          [
            ['charts', 'Gráficas'],
            ['records', 'Récords'],
            ['history', 'Historial'],
          ] as const
        ).map(([key, label]) => (
          <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {sessions.length === 0 ? (
        <p className="empty">Todavía no has hecho este ejercicio.</p>
      ) : tab === 'charts' ? (
        <ChartsTab sessions={sessions} />
      ) : tab === 'records' ? (
        <RecordsTab sessions={sessions} />
      ) : (
        <HistoryTab sessions={sessions} />
      )}

      {editing && (
        <ExerciseSheet
          exercise={exercise}
          usage={sessions.length}
          onClose={() => setEditing(false)}
          onDeleted={() => navigate('/exercises', { replace: true })}
        />
      )}
    </div>
  )
}

function ChartsTab({ sessions }: { sessions: Session[] }) {
  const hasWeight = sessions.some((s) => s.maxWeight > 0)
  const [metric, setMetric] = useState<MetricKey>(hasWeight ? 'e1rm' : 'reps')
  const [range, setRange] = useState<(typeof RANGES)[number]['key']>('1y')
  const [now] = useState(Date.now)
  const m = METRICS[metric]
  const days = RANGES.find((r) => r.key === range)!.days

  const points = useMemo(
    () =>
      sessions
        .filter((s) => now - s.date <= days * DAY)
        .map((s) => ({ x: s.date, y: m.get(s) }))
        .filter((p) => p.y > 0),
    [sessions, now, days, m],
  )
  const best = points.reduce((b, p) => (p.y > b ? p.y : b), 0)
  const spanDays = points.length > 1 ? (points[points.length - 1].x - points[0].x) / DAY : 0
  const axisFmt = (x: number) => (spanDays > 300 ? monthYear.format(x) : fmtShortDate(x))

  return (
    <>
      <div className="segmented" role="group" aria-label="Métrica">
        {(Object.keys(METRICS) as MetricKey[]).map((k) => (
          <button key={k} aria-pressed={metric === k} onClick={() => setMetric(k)}>
            {METRICS[k].short}
          </button>
        ))}
      </div>
      <div className="segmented" role="group" aria-label="Periodo">
        {RANGES.map((r) => (
          <button key={r.key} aria-pressed={range === r.key} onClick={() => setRange(r.key)}>
            {r.label}
          </button>
        ))}
      </div>

      <section className="card chart-card">
        <div className="chart-head">
          <h2>{m.label}</h2>
          {points.length > 0 && (
            <span className="muted small-text">
              Último: <strong className="text-strong">{m.fmt(points[points.length - 1].y)}</strong> · Mejor: {m.fmt(best)}
            </span>
          )}
        </div>
        {points.length === 0 ? (
          <p className="empty">Sin datos en este periodo.</p>
        ) : (
          <LineChart
            points={points}
            label={m.label}
            formatY={m.fmt}
            formatX={fmtMediumDate}
            formatAxisX={axisFmt}
            gapBreak={60 * DAY}
          />
        )}
        {metric === 'e1rm' && (
          <p className="muted small-text">Estimado con la fórmula de Epley: peso × (1 + reps / 30).</p>
        )}
        {points.length > 0 && (
          <details className="table-view">
            <summary>Ver datos ({points.length})</summary>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th className="num">{m.short}</th>
                </tr>
              </thead>
              <tbody>
                {[...points].reverse().map((p) => (
                  <tr key={p.x}>
                    <td>{fmtMediumDate(p.x)}</td>
                    <td className="num">{m.fmt(p.y)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </section>
    </>
  )
}

function RecordCard({ title, rec, value, detail }: { title: string; rec?: PersonalRecord; value: (r: PersonalRecord) => string; detail?: (r: PersonalRecord) => string }) {
  if (!rec) return null
  return (
    <div className="card record">
      <span className="muted small-text">{title}</span>
      <span className="record-value">{value(rec)}</span>
      <span className="muted small-text">
        {detail ? `${detail(rec)} · ` : ''}
        {fmtMediumDate(rec.date)}
      </span>
    </div>
  )
}

function RecordsTab({ sessions }: { sessions: Session[] }) {
  const records = useMemo(() => personalRecords(sessions), [sessions])
  const setText = (r: PersonalRecord) => (r.set ? fmtSet(r.set) : '')
  return (
    <>
      <div className="records-grid">
        <RecordCard title="1RM estimado" rec={records.e1rm} value={(r) => kg(r.value)} detail={setText} />
        <RecordCard title="Peso máximo" rec={records.maxWeight} value={(r) => kg(r.value)} detail={setText} />
        <RecordCard
          title="Mejor serie (peso × reps)"
          rec={records.bestSetVolume}
          value={(r) => `${fmtInt(r.value)} kg`}
          detail={setText}
        />
        <RecordCard title="Volumen en una sesión" rec={records.maxVolume} value={(r) => `${fmtInt(r.value)} kg`} />
        <RecordCard title="Máximo de repeticiones" rec={records.maxReps} value={(r) => `${fmtInt(r.value)} reps`} detail={setText} />
      </div>

      {records.repMaxes.length > 0 && (
        <section className="card">
          <h2>Mejor peso por repeticiones</h2>
          <p className="muted small-text">
            Tu serie más pesada para cada número de repeticiones (o más). Las filas agrupadas comparten la misma serie.
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Reps</th>
                <th className="num">Serie</th>
                <th className="num">1RM est.</th>
                <th className="num">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {repRanges(records.repMaxes).map((r) => (
                <tr key={r.from}>
                  <td>{r.from === r.to ? r.from : `${r.from}–${r.to}`}</td>
                  <td className="num">{fmtSet({ weight: r.weight, reps: r.actualReps })}</td>
                  <td className="num">{kg(estimated1RM(r.weight, r.actualReps))}</td>
                  <td className="num">{fmtShortDate(r.date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  )
}

/** Collapse consecutive rep counts whose best set is the same one, e.g. 1–7 reps: 190 kg × 7. */
function repRanges(rows: Records['repMaxes']) {
  const out: { from: number; to: number; weight: number; actualReps: number; date: number }[] = []
  for (const r of rows) {
    const prev = out[out.length - 1]
    if (prev && prev.weight === r.weight && prev.actualReps === r.actualReps && prev.date === r.date && prev.to === r.reps - 1) {
      prev.to = r.reps
    } else {
      out.push({ from: r.reps, to: r.reps, weight: r.weight, actualReps: r.actualReps, date: r.date })
    }
  }
  return out
}

const PAGE = 20

function HistoryTab({ sessions }: { sessions: Session[] }) {
  const navigate = useNavigate()
  const [limit, setLimit] = useState(PAGE)
  const newestFirst = useMemo(() => [...sessions].reverse(), [sessions])
  return (
    <>
      {newestFirst.slice(0, limit).map((s) => {
        const labels = setLabels(s.sets)
        return (
          <section key={s.workoutId} className="card">
            <button className="exercise-link" onClick={() => navigate(`/workout/${s.workoutId}`)}>
              <strong>{s.workoutName}</strong>
              <br />
              <span className="muted small-text">{fmtDate(s.date)}</span>
            </button>
            <ul className="session-sets">
              {s.sets.map((set, i) => (
                <li key={i}>
                  <span className={`set-tag type-${set.type}`}>{labels[i]}</span>
                  <span>{fmtSet(set)}</span>
                  {set === s.best && set.weight ? (
                    <span className="muted"> · 1RM {kg(estimated1RM(set.weight, set.reps ?? 0))}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      {limit < newestFirst.length && (
        <button className="btn full" onClick={() => setLimit((l) => l + PAGE)}>
          Ver más
        </button>
      )}
    </>
  )
}
