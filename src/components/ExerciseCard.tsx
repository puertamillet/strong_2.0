import { useMemo, useState } from 'react'
import { emptySet, REST_OPTIONS, type Exercise, type SetType, type WorkoutExercise, type WorkoutSet } from '../db'
import { fmtClock, fmtNumber, fmtSet, SET_TYPE_NAMES, setLabels } from '../lib/format'
import { restTimer } from '../lib/restTimer'
import { isPR, type ExerciseContext } from '../lib/workouts'
import { confirmDialog } from '../lib/dialog'
import { Icon } from './icons'
import { NumInput } from './NumInput'

/**
 * - `active`: the workout in progress; ticking a set starts the rest timer.
 * - `edit`: a past workout being edited; sets can be ticked, no timer.
 * - `template`: a template; no ticks, each set can be removed.
 */
export type CardMode = 'active' | 'edit' | 'template'

interface CardProps {
  we: WorkoutExercise
  exercise?: Exercise
  context?: ExerciseContext
  mode: CardMode
  isFirst: boolean
  isLast: boolean
  onChange: (fn: (we: WorkoutExercise) => void) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
  onOpenExercise: (exerciseId: string) => void
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

export function ExerciseCard({ we, exercise, context, mode, isFirst, isLast, onChange, onMove, onRemove, onOpenExercise }: CardProps) {
  const previous = context?.last
  const [showNotes, setShowNotes] = useState(Boolean(we.notes))
  const placeholders = useMemo(() => placeholdersFor(we, previous), [we, previous])
  const labels = setLabels(we.sets)
  const name = exercise?.name ?? 'Ejercicio eliminado'

  async function onAction(action: string) {
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
        if (
          await confirmDialog({
            title: `¿Quitar ${name}?`,
            message: mode === 'template' ? 'Se quitará de la plantilla.' : 'Se quitará del entreno con sus series.',
            confirm: 'Quitar',
            danger: true,
          })
        ) {
          onRemove()
        }
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
      if (mode === 'active' && we.restSeconds > 0) restTimer.start(we.restSeconds)
    } else {
      onChange((e) => {
        e.sets[si].done = false
      })
    }
  }

  return (
    <section className="card exercise-card">
      <div className="exercise-head">
        <button className="exercise-link" onClick={() => exercise && onOpenExercise(exercise.id)}>
          <h3>{name}</h3>
        </button>
        <label className="select-chip" title="Más opciones">
          ⋯
          <select value="" onChange={(e) => void onAction(e.target.value)} aria-label="Opciones del ejercicio">
            <option value="" disabled>
              Opciones
            </option>
            {mode !== 'template' && <option value="notes">Añadir nota</option>}
            {!isFirst && <option value="up">Mover arriba</option>}
            {!isLast && <option value="down">Mover abajo</option>}
            <option value="remove">Quitar ejercicio</option>
          </select>
        </label>
      </div>

      <div className="exercise-meta">
        <label className="select-chip">
          <Icon name="timer" size={16} /> {we.restSeconds ? fmtClock(we.restSeconds) : 'Sin descanso'}
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
        <span>{mode === 'template' ? '' : '✓'}</span>
      </div>
      {we.sets.map((s, si) => {
        const ph = placeholders[si]
        const fromPrevious = ph && previous?.sets.includes(ph) ? ph : undefined
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
            {mode !== 'template' && isPR(s, context) ? (
              <span className="prev pr-badge">
                <Icon name="trophy" size={16} /> Récord
              </span>
            ) : (
              <span className="prev">{fromPrevious ? fmtSet(fromPrevious) : '—'}</span>
            )}
            <NumInput
              className="cell-input"
              ariaLabel="Peso en kg"
              value={s.weight}
              placeholder={fmtNumber(ph?.weight)}
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
              placeholder={fmtNumber(ph?.reps)}
              onChange={(v) =>
                onChange((x) => {
                  x.sets[si].reps = v
                })
              }
            />
            {mode === 'template' ? (
              <button
                className="remove-set-btn"
                aria-label="Eliminar serie"
                onClick={() =>
                  onChange((x) => {
                    x.sets.splice(si, 1)
                  })
                }
              >
                <Icon name="close" size={16} />
              </button>
            ) : (
              <button
                className={`check-btn ${s.done ? 'on' : ''}`}
                aria-label={s.done ? 'Desmarcar serie' : 'Marcar serie'}
                onClick={() => toggleDone(si)}
              >
                ✓
              </button>
            )}
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
