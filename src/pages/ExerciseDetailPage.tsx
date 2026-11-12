import { useLiveQuery } from 'dexie-react-hooks'
import { lazy, Suspense, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { LineChart } from '../components/charts'
import { ExerciseSheet } from '../components/ExerciseSheet'
import { ExerciseTags } from '../components/ExerciseTags'
import { CloseButton, Sheet } from '../components/Sheet'
import { db, type Exercise } from '../db'
import { exercisePaint, useBodyFigure } from '../lib/bodyFigure'
import { missingFields } from '../lib/exercises'
import { useCloseSheet, useOpenSheet } from '../lib/sheets'
import { fmtDate, fmtInt, fmtMediumDate, fmtNumber, fmtSet, fmtShortDate, setLabels } from '../lib/format'
import { exerciseSessions, personalRecords, type PersonalRecord, type Records, type Session } from '../lib/stats'
import { estimated1RM } from '../lib/workouts'

type Tab = 'about' | 'charts' | 'records' | 'history'

/** The drawings are big: they load when an exercise page first opens. */
const BodyFigure = lazy(() => import('../components/BodyFigure'))
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

/** Exercise sheet opened from the Ejercicios tab (/exercises/:id). */
export function ExerciseDetailRoute() {
  const { id = '' } = useParams()
  const close = useCloseSheet()
  const openSheet = useOpenSheet()
  return <ExerciseDetail id={id} onClose={close} onOpenWorkout={(wid) => openSheet(`/history/${wid}`)} />
}

interface DetailProps {
  id: string
  onClose: () => void
  /** Stacking level: 2 when opened from a workout or template sheet. */
  level?: number
  /** Opens a past workout from the history tab; left out inside other sheets. */
  onOpenWorkout?: (workoutId: string) => void
}

export function ExerciseDetail({ id, onClose, level = 1, onOpenWorkout }: DetailProps) {
  const exercise = useLiveQuery(() => db.exercises.get(id).then((e) => e ?? null), [id])
  const sessions = useLiveQuery(
    async () => exerciseSessions(await db.workouts.where('exerciseIds').equals(id).toArray(), id),
    [id],
  )
  const [tab, setTab] = useState<Tab>('about')
  const [editing, setEditing] = useState(false)

  const loaded = exercise !== undefined && sessions !== undefined
  return (
    <Sheet
      level={level}
      label={exercise?.name ?? 'Ejercicio'}
      title={exercise?.name}
      left={<CloseButton onClick={onClose} />}
      right={
        exercise && (
          <button className="link strong" onClick={() => setEditing(true)}>
            Editar
          </button>
        )
      }
      onDismiss={onClose}
    >
      {!loaded ? null : exercise === null ? (
        <p className="empty">Este ejercicio ya no existe.</p>
      ) : (
        <>
          <div className="detail-subtitle">
            <ExerciseTags exercise={exercise} full />
            <span className="muted small-text">
              {sessions.length} {sessions.length === 1 ? 'sesión' : 'sesiones'}
            </span>
          </div>

          <div className="segmented" role="group" aria-label="Sección">
            {(
              [
                ['about', 'Ficha'],
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

          {tab === 'about' ? (
            <AboutTab exercise={exercise} onEdit={() => setEditing(true)} />
          ) : sessions.length === 0 ? (
            <p className="empty">Todavía no has hecho este ejercicio.</p>
          ) : tab === 'charts' ? (
            <ChartsTab sessions={sessions} />
          ) : tab === 'records' ? (
            <RecordsTab sessions={sessions} />
          ) : (
            <HistoryTab sessions={sessions} onOpenWorkout={onOpenWorkout} />
          )}

          {editing && (
            <ExerciseSheet
              exercise={exercise}
              usage={sessions.length}
              level={level + 1}
              onClose={() => setEditing(false)}
              onDeleted={onClose}
            />
          )}
        </>
      )}
    </Sheet>
  )
}

/** What the exercise is: the muscles it works on the body figure, its notes and its names in Strong. */
function AboutTab({ exercise, onEdit }: { exercise: Exercise; onEdit: () => void }) {
  const sex = useBodyFigure()
  const primary = exercise.primary ?? []
  const secondary = exercise.secondary ?? []
  const missing = missingFields(exercise)
  return (
    <>
      <section className="card about-card">
        {primary.length > 0 && (
          <Suspense fallback={<div className="body-figure" />}>
            <BodyFigure sex={sex} paint={exercisePaint(primary, secondary)} />
          </Suspense>
        )}
        <dl className="muscle-list">
          <div>
            <dt>
              <span className="swatch primary" /> Músculos principales
            </dt>
            <dd>{primary.join(', ') || 'Sin indicar'}</dd>
          </div>
          <div>
            <dt>
              <span className="swatch secondary" /> Músculos secundarios
            </dt>
            <dd>{secondary.length ? secondary.join(', ') : exercise.secondary ? 'Ninguno' : 'Sin indicar'}</dd>
          </div>
        </dl>
        {missing.length > 0 && (
          <button className="btn full" onClick={onEdit}>
            Completar: {missing.join(', ')}
          </button>
        )}
      </section>
      {exercise.notes && (
        <section className="card">
          <h2>Notas</h2>
          <p className="pre-line">{exercise.notes}</p>
        </section>
      )}
      {exercise.strongNames?.length ? (
        <p className="muted small-text detail-footnote">En Strong: {exercise.strongNames.join(' · ')}</p>
      ) : null}
    </>
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

function HistoryTab({ sessions, onOpenWorkout }: { sessions: Session[]; onOpenWorkout?: (workoutId: string) => void }) {
  const [limit, setLimit] = useState(PAGE)
  const newestFirst = useMemo(() => [...sessions].reverse(), [sessions])
  return (
    <>
      {newestFirst.slice(0, limit).map((s) => {
        const labels = setLabels(s.sets)
        return (
          <section key={s.workoutId} className="card">
            {onOpenWorkout ? (
              <button className="exercise-link" onClick={() => onOpenWorkout(s.workoutId)}>
                <strong>{s.workoutName}</strong>
                <br />
                <span className="muted small-text">{fmtDate(s.date)}</span>
              </button>
            ) : (
              <div>
                <strong>{s.workoutName}</strong>
                <br />
                <span className="muted small-text">{fmtDate(s.date)}</span>
              </div>
            )}
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
