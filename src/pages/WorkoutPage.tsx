import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ExercisePicker } from '../components/ExercisePicker'
import { NumInput } from '../components/NumInput'
import {
  db,
  emptySet,
  REST_OPTIONS,
  type Exercise,
  type SetType,
  type WorkoutExercise,
  type WorkoutSet,
} from '../db'
import { fmtClock, fmtDate, fmtSet, SET_TYPE_NAMES, setLabels } from '../lib/format'
import { restTimer } from '../lib/restTimer'
import {
  addExercisesToWorkout,
  countDoneSets,
  differsFromTemplate,
  discardWorkout,
  finishWorkout,
  lastPerformance,
  mutateWorkout,
  saveAsTemplate,
  updateTemplateFromWorkout,
} from '../lib/workouts'

export function WorkoutPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const workout = useLiveQuery(() => db.workouts.get(id).then((w) => w ?? null), [id])
  const exercises = useLiveQuery(
    async () => new Map((await db.exercises.toArray()).map((e) => [e.id, e] as const)),
    [],
  )
  const exerciseKey = workout?.exerciseIds.join(',') ?? ''
  const previous = useLiveQuery(async () => {
    const ids = exerciseKey ? exerciseKey.split(',') : []
    const entries = await Promise.all(ids.map(async (eid) => [eid, await lastPerformance(eid, id)] as const))
    return new Map(entries)
  }, [exerciseKey, id])
  const [picking, setPicking] = useState(false)

  if (workout === undefined || !exercises) return <div className="page" />
  if (workout === null) {
    return (
      <div className="page">
        <p className="empty">Este entreno ya no existe.</p>
        <button className="btn" onClick={() => navigate('/')}>
          Volver
        </button>
      </div>
    )
  }

  const active = workout.endedAt === null
  const mutate = (fn: Parameters<typeof mutateWorkout>[1]) => void mutateWorkout(id, fn)

  async function onFinish() {
    if (!workout) return
    const total = workout.exercises.reduce((n, e) => n + e.sets.length, 0)
    const done = countDoneSets(workout)
    if (done === 0) {
      if (!confirm('No has completado ninguna serie. ¿Descartar este entreno?')) return
    } else if (done < total && !confirm('Las series sin marcar se descartarán. ¿Terminar el entreno?')) {
      return
    }
    const template = workout.templateId ? await db.templates.get(workout.templateId) : undefined
    const kept = await finishWorkout(id)
    restTimer.stop()
    if (kept && active) {
      if (template && differsFromTemplate(workout, template)) {
        if (confirm(`¿Actualizar la plantilla «${template.name}» con los cambios de hoy?`)) {
          await updateTemplateFromWorkout(workout, template.id)
        }
      }
    }
    navigate(kept ? '/history' : '/', { replace: true })
  }

  async function onDiscard() {
    if (!confirm(active ? '¿Cancelar este entreno? Se perderá lo registrado.' : '¿Eliminar este entreno del historial?')) return
    await discardWorkout(id)
    if (active) restTimer.stop()
    navigate(active ? '/' : '/history', { replace: true })
  }

  async function onSaveTemplate() {
    if (!workout) return
    const name = prompt('Nombre de la plantilla', workout.name)
    if (!name) return
    await saveAsTemplate(workout, name.trim())
    alert('Plantilla guardada.')
  }

  return (
    <div className="page workout-page">
      <header className="page-header sticky">
        <button className="link" onClick={() => navigate(-1)}>
          ‹ Atrás
        </button>
        <span className="muted">{active ? <Elapsed since={workout.startedAt} /> : fmtDate(workout.startedAt)}</span>
        <button className="btn small primary" onClick={onFinish}>
          {active ? 'Terminar' : 'Guardar'}
        </button>
      </header>

      <input
        className="title-input"
        value={workout.name}
        aria-label="Nombre del entreno"
        onChange={(e) => {
          const name = e.target.value
          mutate((w) => {
            w.name = name
          })
        }}
      />

      {workout.exercises.map((we, ei) => (
        <ExerciseCard
          key={`${we.exerciseId}-${ei}`}
          we={we}
          exercise={exercises.get(we.exerciseId)}
          previous={previous?.get(we.exerciseId)}
          isFirst={ei === 0}
          isLast={ei === workout.exercises.length - 1}
          active={active}
          onChange={(fn) =>
            mutate((w) => {
              fn(w.exercises[ei])
            })
          }
          onMove={(dir) =>
            mutate((w) => {
              const [item] = w.exercises.splice(ei, 1)
              w.exercises.splice(ei + dir, 0, item)
            })
          }
          onRemove={() =>
            mutate((w) => {
              w.exercises.splice(ei, 1)
            })
          }
        />
      ))}

      <div className="stack">
        <button className="btn primary-outline" onClick={() => setPicking(true)}>
          Añadir ejercicios
        </button>
        {workout.exercises.length > 0 && (
          <button className="btn" onClick={onSaveTemplate}>
            Guardar como plantilla
          </button>
        )}
        <button className="btn danger" onClick={onDiscard}>
          {active ? 'Cancelar entreno' : 'Eliminar entreno'}
        </button>
      </div>

      {picking && (
        <ExercisePicker
          onClose={() => setPicking(false)}
          onPick={async (ids) => {
            setPicking(false)
            await addExercisesToWorkout(id, ids)
          }}
        />
      )}
    </div>
  )
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return <>{fmtClock((now - since) / 1000)}</>
}

interface CardProps {
  we: WorkoutExercise
  exercise?: Exercise
  previous?: WorkoutExercise
  isFirst: boolean
  isLast: boolean
  active: boolean
  onChange: (fn: (we: WorkoutExercise) => void) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
}

/** Placeholder values for each set: same-type set from last time, else the set above. */
function placeholdersFor(we: WorkoutExercise, previous?: WorkoutExercise): (WorkoutSet | undefined)[] {
  const prevByType = new Map<SetType, WorkoutSet[]>()
  for (const s of previous?.sets ?? []) {
    prevByType.set(s.type, [...(prevByType.get(s.type) ?? []), s])
  }
  const seen = new Map<SetType, number>()
  return we.sets.map((s, i) => {
    const n = seen.get(s.type) ?? 0
    seen.set(s.type, n + 1)
    const fromHistory = prevByType.get(s.type)?.[n]
    if (fromHistory) return fromHistory
    const above = we.sets[i - 1]
    return above && (above.weight !== null || above.reps !== null) ? above : undefined
  })
}

function ExerciseCard({ we, exercise, previous, isFirst, isLast, active, onChange, onMove, onRemove }: CardProps) {
  const [showNotes, setShowNotes] = useState(Boolean(we.notes))
  const placeholders = useMemo(() => placeholdersFor(we, previous), [we, previous])
  const labels = setLabels(we.sets)

  function onAction(action: string) {
    switch (action) {
      case 'up':
        onMove(-1)
        break
      case 'down':
        onMove(1)
        break
      case 'notes':
        setShowNotes(true)
        break
      case 'remove':
        if (confirm(`¿Quitar ${exercise?.name ?? 'este ejercicio'} del entreno?`)) onRemove()
        break
    }
  }

  function toggleDone(si: number) {
    const set = we.sets[si]
    const ph = placeholders[si]
    if (!set.done) {
      const weight = set.weight ?? ph?.weight ?? null
      const reps = set.reps ?? ph?.reps ?? null
      if (reps === null) return
      onChange((e) => {
        e.sets[si] = { ...e.sets[si], weight, reps, done: true }
      })
      if (active && we.restSeconds > 0) restTimer.start(we.restSeconds)
    } else {
      onChange((e) => {
        e.sets[si].done = false
      })
    }
  }

  return (
    <section className="card exercise-card">
      <div className="exercise-head">
        <h3>{exercise?.name ?? 'Ejercicio eliminado'}</h3>
        <label className="select-chip" title="Más opciones">
          ⋯
          <select value="" onChange={(e) => onAction(e.target.value)} aria-label="Opciones del ejercicio">
            <option value="" disabled>
              Opciones
            </option>
            <option value="notes">Añadir nota</option>
            {!isFirst && <option value="up">Mover arriba</option>}
            {!isLast && <option value="down">Mover abajo</option>}
            <option value="remove">Quitar ejercicio</option>
          </select>
        </label>
      </div>

      <div className="exercise-meta">
        <label className="select-chip">
          ⏱ {we.restSeconds ? fmtClock(we.restSeconds) : 'Sin descanso'}
          <select
            value={we.restSeconds}
            aria-label="Tiempo de descanso"
            onChange={(e) => {
              const v = Number(e.target.value)
              onChange((x) => {
                x.restSeconds = v
              })
            }}
          >
            {[...new Set([...REST_OPTIONS, we.restSeconds])]
              .sort((a, b) => a - b)
              .map((s) => (
                <option key={s} value={s}>
                  {s ? fmtClock(s) : 'Sin descanso'}
                </option>
              ))}
          </select>
        </label>
        {!showNotes && previous?.notes && <span className="muted small-text">Nota anterior: {previous.notes}</span>}
      </div>

      {showNotes && (
        <textarea
          className="notes"
          placeholder={previous?.notes ?? 'Nota'}
          value={we.notes ?? ''}
          onChange={(e) => {
            const v = e.target.value
            onChange((x) => {
              x.notes = v || undefined
            })
          }}
        />
      )}

      <div className="set-grid set-grid-head">
        <span>Serie</span>
        <span>Anterior</span>
        <span>kg</span>
        <span>Reps</span>
        <span>✓</span>
      </div>
      {we.sets.map((s, si) => {
        const ph = placeholders[si]
        const prevForType = previous ? ph : undefined
        return (
          <div key={si} className={`set-grid set-row ${s.done ? 'done' : ''}`}>
            <label className={`set-type type-${s.type}`}>
              {labels[si]}
              <select
                value={s.type}
                aria-label="Tipo de serie"
                onChange={(e) => {
                  const v = e.target.value
                  onChange((x) => {
                    if (v === 'delete') x.sets.splice(si, 1)
                    else x.sets[si].type = v as SetType
                  })
                }}
              >
                {(Object.keys(SET_TYPE_NAMES) as SetType[]).map((t) => (
                  <option key={t} value={t}>
                    {SET_TYPE_NAMES[t]}
                  </option>
                ))}
                <option value="delete">Eliminar serie</option>
              </select>
            </label>
            <span className="prev">{prevForType && previous?.sets.includes(prevForType) ? fmtSet(prevForType) : '—'}</span>
            <NumInput
              className="cell-input"
              ariaLabel="Peso en kg"
              value={s.weight}
              placeholder={ph?.weight != null ? String(ph.weight) : ''}
              onChange={(v) =>
                onChange((x) => {
                  x.sets[si].weight = v
                })
              }
            />
            <NumInput
              className="cell-input"
              ariaLabel="Repeticiones"
              decimal={false}
              value={s.reps}
              placeholder={ph?.reps != null ? String(ph.reps) : ''}
              onChange={(v) =>
                onChange((x) => {
                  x.sets[si].reps = v
                })
              }
            />
            <button
              className={`check-btn ${s.done ? 'on' : ''}`}
              aria-label={s.done ? 'Desmarcar serie' : 'Marcar serie'}
              onClick={() => toggleDone(si)}
            >
              ✓
            </button>
          </div>
        )
      })}
      <button
        className="btn ghost full"
        onClick={() =>
          onChange((x) => {
            x.sets.push(emptySet())
          })
        }
      >
        ＋ Añadir serie
      </button>
    </section>
  )
}
