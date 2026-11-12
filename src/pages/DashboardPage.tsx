import { useLiveQuery } from 'dexie-react-hooks'
import { lazy, Suspense, useState } from 'react'
import { ColumnChart } from '../components/charts'
import { Icon } from '../components/icons'
import { db } from '../db'
import { HEAT_LEVELS, heatPaint, useBodyFigure } from '../lib/bodyFigure'
import { MUSCLE_GROUP_NAMES, MUSCLE_GROUPS, MUSCLES, type Muscle } from '../lib/catalog'
import { fmtDuration, fmtInt, fmtNumber, fmtShortDate } from '../lib/format'
import { weeklyStats, weekStart, weekStarts, type WeekStats } from '../lib/stats'

const BodyFigure = lazy(() => import('../components/BodyFigure'))

const WEEKS = 12
const HOUR = 3_600_000

const decimal = (v: number) => fmtNumber(Math.round(v * 10) / 10)
const count = (n: number, one: string, many: string) => `${fmtInt(n)} ${Math.round(n) === 1 ? one : many}`
const thousands = (v: number) => (v >= 1000 ? `${decimal(v / 1000)}K` : fmtInt(v))

interface Metric {
  label: string
  title: string
  value: (w: WeekStats) => number
  /** The value in a tile, and the weekly average. */
  text: (v: number) => string
  average: (v: number) => string
  /** In the tooltips and the table. */
  long: (v: number) => string
  /** What the chart plots, and its axis text. */
  plot: (v: number) => number
  axis: (v: number) => string
  counts: boolean
}

const METRICS = {
  workouts: {
    label: 'Entrenos',
    title: 'Entrenos por semana',
    value: (w) => w.workouts,
    text: fmtInt,
    average: decimal,
    long: (v) => count(v, 'entreno', 'entrenos'),
    plot: (v) => v,
    axis: fmtInt,
    counts: true,
  },
  sets: {
    label: 'Series',
    title: 'Series por semana',
    value: (w) => w.sets,
    text: fmtInt,
    average: decimal,
    long: (v) => count(v, 'serie', 'series'),
    plot: (v) => v,
    axis: fmtInt,
    counts: true,
  },
  volume: {
    label: 'Tonelaje',
    title: 'Tonelaje por semana',
    value: (w) => w.volume,
    text: (v) => `${fmtInt(v)} kg`,
    average: (v) => `${fmtInt(v)} kg`,
    long: (v) => `${fmtInt(v)} kg`,
    plot: (v) => v,
    axis: thousands,
    counts: false,
  },
  duration: {
    label: 'Tiempo',
    title: 'Tiempo por semana',
    value: (w) => w.duration,
    text: fmtDuration,
    average: fmtDuration,
    long: fmtDuration,
    plot: (v) => v / HOUR,
    axis: (v) => `${decimal(v)} h`,
    counts: false,
  },
} satisfies Record<string, Metric>

type MetricKey = keyof typeof METRICS
const METRIC_KEYS = Object.keys(METRICS) as MetricKey[]

/** "Esta semana", "Semana pasada" or "Semana del 3 nov". */
function weekName(weeks: WeekStats[], i: number): string {
  if (i === weeks.length - 1) return 'Esta semana'
  if (i === weeks.length - 2) return 'Semana pasada'
  return `Semana del ${fmtShortDate(weeks[i].week)}`
}

const axisLabel = (weeks: WeekStats[], i: number) => (i === weeks.length - 1 ? 'Esta semana' : fmtShortDate(weeks[i].week))

/** The weekly figures at a glance: this week against the average, each one week by week, and the sets per muscle. */
export function DashboardPage() {
  const [now] = useState(Date.now)
  const [metric, setMetric] = useState<MetricKey>('workouts')
  const data = useLiveQuery(async () => {
    const [workouts, exercises, first] = await Promise.all([
      db.workouts.where('startedAt').aboveOrEqual(weekStarts(WEEKS, now)[0]).toArray(),
      db.exercises.toArray(),
      db.workouts
        .orderBy('startedAt')
        .filter((w) => w.endedAt !== null)
        .first(),
    ])
    return { weeks: weeklyStats(workouts, exercises, WEEKS, now), since: first ? weekStart(first.startedAt) : null }
  }, [now])

  if (!data) return <div className="page" />
  const { weeks, since } = data
  const current = weeks[weeks.length - 1]
  // The average leaves out this week, which is not over, and the weeks before the first workout.
  const past = since === null ? [] : weeks.slice(0, -1).filter((w) => w.week >= since)
  const average = (m: Metric) => past.reduce((sum, w) => sum + m.value(w), 0) / past.length
  const m: Metric = METRICS[metric]

  return (
    <div className="page">
      <header className="page-header">
        <h1>Panel</h1>
      </header>

      {since === null ? (
        <p className="empty">Cuando termines tu primer entreno, aquí verás tus estadísticas de cada semana.</p>
      ) : (
        <>
          <div className="section-head">
            <h2>Esta semana</h2>
            {past.length > 0 && (
              <span className="muted small-text">
                Media: {past.length === 1 ? 'la semana pasada' : `las ${past.length} anteriores`}
              </span>
            )}
          </div>
          <div className="stat-grid">
            {METRIC_KEYS.map((key) => {
              const k: Metric = METRICS[key]
              return (
                <button key={key} className="card stat stat-button" aria-pressed={metric === key} onClick={() => setMetric(key)}>
                  <span className="stat-label">{k.label}</span>
                  <span className="stat-value">{k.text(k.value(current))}</span>
                  {past.length > 0 && <span className="stat-note">Media {k.average(average(k))}</span>}
                </button>
              )
            })}
          </div>

          <section className="card chart-card">
            <div className="chart-head">
              <h2>{m.title}</h2>
              <span className="muted small-text">Últimas {WEEKS} semanas</span>
            </div>
            <ColumnChart
              key={metric}
              label={`${m.title} en las últimas ${WEEKS} semanas`}
              format={m.axis}
              counts={m.counts}
              data={weeks.map((w, i) => ({
                key: w.week,
                value: m.plot(m.value(w)),
                axis: axisLabel(weeks, i),
                description: `${weekName(weeks, i)}: ${m.long(m.value(w))}`,
              }))}
            />
            <details className="table-view">
              <summary>Ver datos</summary>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Semana</th>
                    <th className="num">{m.label}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...weeks].reverse().map((w) => (
                    <tr key={w.week}>
                      <td>{fmtShortDate(w.week)}</td>
                      <td className="num">{m.long(m.value(w))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </section>

          <MuscleSets weeks={weeks} />
        </>
      )}
    </div>
  )
}

/** Sets per muscle in a week, on the body and as bars, with each muscle's weeks one tap away. */
function MuscleSets({ weeks }: { weeks: WeekStats[] }) {
  const sex = useBodyFigure()
  const last = weeks.length - 1
  // Opens on this week, or on the last one while this one has nothing yet.
  const [index, setIndex] = useState(weeks[last].sets > 0 ? last : last - 1)
  const [open, setOpen] = useState<Muscle | null>(null)
  const week = weeks[index]
  // The same scale every week, so they can be compared.
  const top = Math.max(10, ...weeks.flatMap((w) => MUSCLES.map((mu) => w.muscles[mu])))

  return (
    <section className="card chart-card">
      <div className="chart-head">
        <h2>Series por músculo</h2>
      </div>
      <div className="week-stepper">
        <button className="icon-btn" aria-label="Semana anterior" disabled={index === 0} onClick={() => setIndex(index - 1)}>
          <Icon name="chevronLeft" size={22} />
        </button>
        <div className="week-stepper-title" aria-live="polite">
          <strong>{weekName(weeks, index)}</strong>
          <span className="muted small-text">{count(week.sets, 'serie', 'series')}</span>
        </div>
        <button className="icon-btn" aria-label="Semana siguiente" disabled={index === last} onClick={() => setIndex(index + 1)}>
          <Icon name="chevronRight" size={22} />
        </button>
      </div>

      <Suspense fallback={<div className="body-figure" />}>
        <BodyFigure sex={sex} paint={heatPaint(week.muscles)} />
      </Suspense>
      <div className="heat-legend" aria-hidden="true">
        <span>Series</span>
        <span>
          <i className="swatch heat-0" />0
        </span>
        {HEAT_LEVELS.map((l, i) => (
          <span key={l.label}>
            <i className={`swatch heat-${i + 1}`} />
            {l.label}
          </span>
        ))}
      </div>

      {MUSCLE_GROUP_NAMES.map((group) => (
        <div key={group} className="muscle-group">
          <h3 className="group-label">{group}</h3>
          <ul className="muscle-bars">
            {MUSCLE_GROUPS[group].map((muscle) => {
              const n = week.muscles[muscle]
              const isOpen = open === muscle
              return (
                <li key={muscle}>
                  <button
                    className="muscle-bar"
                    aria-expanded={isOpen}
                    aria-label={`${muscle}: ${count(n, 'serie', 'series')}`}
                    onClick={() => setOpen(isOpen ? null : muscle)}
                  >
                    <span className="muscle-bar-name">{muscle}</span>
                    <span className="muscle-bar-track">
                      {n > 0 && <span className="muscle-bar-fill" style={{ width: `${(n / top) * 100}%` }} />}
                    </span>
                    <span className={n ? 'muscle-bar-value' : 'muscle-bar-value muted'}>{n}</span>
                    <Icon name={isOpen ? 'chevronUp' : 'chevronDown'} size={16} />
                  </button>
                  {isOpen && (
                    <ColumnChart
                      height={130}
                      label={`Series de ${muscle} por semana en las últimas ${WEEKS} semanas`}
                      data={weeks.map((w, i) => ({
                        key: w.week,
                        value: w.muscles[muscle],
                        axis: axisLabel(weeks, i),
                        description: `${weekName(weeks, i)}: ${count(w.muscles[muscle], 'serie', 'series')}`,
                      }))}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}

      {week.unassigned > 0 && (
        <p className="muted small-text">
          {count(week.unassigned, 'serie', 'series')} de ejercicios sin músculos principales no cuentan aquí.
        </p>
      )}
      <p className="muted small-text">
        Cada ejercicio cuenta en sus músculos principales, sin calentamientos. En los unilaterales, cada par de lados es una
        serie.
      </p>
    </section>
  )
}
