import { Fragment, useMemo, useState } from 'react'
import { restAfter, type Exercise, type RepRange, type SetType, type WorkoutExercise, type WorkoutSet } from '../db'
import { fmtClock, fmtNumber, fmtRange, fmtRest, fmtSet, parseRange, SET_TYPE_NAMES, setLabels } from '../lib/format'
import { restTimer, useRestTimer } from '../lib/restTimer'
import { useNow } from '../lib/useNow'
import { isPR, nextSet, type ExerciseContext } from '../lib/workouts'
import { confirmDialog, pickDuration } from '../lib/dialog'
import { exerciseLabel } from '../lib/exercises'
import { ExerciseTags } from './ExerciseTags'
import { Icon } from './icons'
import { NumInput } from './NumInput'

/**
 * - `active`: the workout in progress; ticking a set starts the rest timer.
 * - `edit`: a past workout being edited; sets can be ticked, no timer.
 * - `template`: a template; no ticks, each set can be removed and has a target range.
 */
export type CardMode = 'active' | 'edit' | 'template'

interface CardProps {
  we: WorkoutExercise
  exercise?: Exercise
  context?: ExerciseContext
  mode: CardMode
  /** In the workout in progress: identifies the exercise, so a running rest shows under its set. */
  restKey?: string
  isFirst: boolean
  isLast: boolean
  onChange: (fn: (we: WorkoutExercise) => void) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
  onOpenExercise: (exerciseId: string) => void
}

const WORKING: ReadonlySet<SetType> = new Set(['normal', 'top', 'backoff'])

/**
 * Placeholder values for each set: the same kind of set from last time; for working sets, else
 * the working set in the same position (a top set after sets logged as normal, as in Strong);
 * else the set above.
 */
function placeholdersFor(we: WorkoutExercise, previous?: WorkoutExercise): (WorkoutSet | undefined)[] {
  const prevByType = new Map<SetType, WorkoutSet[]>()
  for (const s of previous?.sets ?? []) {
    prevByType.set(s.type, [...(prevByType.get(s.type) ?? []), s])
  }
  const prevWorking = (previous?.sets ?? []).filter((s) => WORKING.has(s.type))
  const seen = new Map<SetType, number>()
  let working = 0
  return we.sets.map((s, i) => {
    const n = seen.get(s.type) ?? 0
    seen.set(s.type, n + 1)
    const position = WORKING.has(s.type) ? working++ : -1
    const fromHistory = prevByType.get(s.type)?.[n] ?? (position >= 0 && !prevByType.has(s.type) ? prevWorking[position] : undefined)
    if (fromHistory) return fromHistory
    const above = we.sets[i - 1]
    return above && (above.weight !== null || above.reps !== null) ? above : undefined
  })
}

/** The rest shared by all the sets, or null if they differ. */
function sharedRest(we: WorkoutExercise): number | null {
  const rests = we.sets.map((s) => restAfter(s, we))
  if (!rests.length) return we.restSeconds
  return rests.every((r) => r === rests[0]) ? rests[0] : null
}

export function ExerciseCard({
  we,
  exercise,
  context,
  mode,
  restKey,
  isFirst,
  isLast,
  onChange,
  onMove,
  onRemove,
  onOpenExercise,
}: CardProps) {
  const previous = context?.last
  const [showNotes, setShowNotes] = useState(Boolean(we.notes))
  const [showSticky, setShowSticky] = useState(Boolean(we.stickyNote))
  const placeholders = useMemo(() => placeholdersFor(we, previous), [we, previous])
  const labels = setLabels(we.sets)
  const name = exercise ? exerciseLabel(exercise) : 'Ejercicio eliminado'

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
      case 'sticky':
        setShowSticky(true)
        break
      case 'rests':
        await editAllRests()
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

  /** One rest for every set (they can be changed one by one afterwards). */
  async function editAllRests() {
    const v = await pickDuration('Descanso de todas las series', sharedRest(we) ?? we.restSeconds, { message: name })
    if (v === null) return
    onChange((e) => {
      e.restSeconds = v
      for (const s of e.sets) delete s.rest
    })
  }

  async function editRest(si: number) {
    const v = await pickDuration('Descanso', restAfter(we.sets[si], we), { message: `${name} · serie ${labels[si]}` })
    if (v === null) return
    onChange((e) => {
      e.sets[si].rest = v
    })
  }

  /** Ticks a set (taking the placeholder values if none were typed) and starts its rest. */
  function toggleDone(si: number) {
    const set = we.sets[si]
    if (set.done) {
      onChange((e) => {
        e.sets[si].done = false
      })
      return
    }
    const ph = placeholders[si]
    const weight = set.weight ?? ph?.weight ?? null
    const reps = set.reps ?? ph?.reps ?? null
    if (reps === null) return
    onChange((e) => {
      const s = e.sets[si]
      s.weight = weight
      s.reps = reps
      s.done = true
    })
    if (mode === 'active') {
      const seconds = restAfter(set, we)
      if (seconds > 0) restTimer.start(seconds, restKey === undefined ? undefined : `${restKey}:${si}`)
    }
  }

  return (
    <section className="card exercise-card">
      <div className="exercise-head">
        <button className="exercise-link" onClick={() => exercise && onOpenExercise(exercise.id)}>
          <h3>{exercise?.name ?? name}</h3>
          {exercise && <ExerciseTags exercise={exercise} />}
        </button>
        <label className="select-chip" title="Más opciones">
          ⋯
          <select value="" onChange={(e) => void onAction(e.target.value)} aria-label="Opciones del ejercicio">
            <option value="" disabled>
              Opciones
            </option>
            {!showSticky && <option value="sticky">Añadir nota fija</option>}
            {!showNotes && <option value="notes">Añadir nota</option>}
            <option value="rests">Cambiar todos los descansos</option>
            {!isFirst && <option value="up">Mover arriba</option>}
            {!isLast && <option value="down">Mover abajo</option>}
            <option value="remove">Quitar ejercicio</option>
          </select>
        </label>
      </div>

      {showSticky && (
        <textarea
          className="sticky-note"
          aria-label="Nota fija"
          placeholder="Nota fija: se ve siempre con el ejercicio"
          rows={Math.max(1, (we.stickyNote ?? '').split('\n').length)}
          autoFocus={!we.stickyNote}
          value={we.stickyNote ?? ''}
          onChange={(e) => {
            const v = e.target.value
            onChange((x) => {
              if (v.trim()) x.stickyNote = v
              else delete x.stickyNote
            })
          }}
          onBlur={() => {
            if (!we.stickyNote) setShowSticky(false)
          }}
        />
      )}

      {!showNotes && previous?.notes && mode !== 'template' && (
        <p className="muted small-text">Nota anterior: {previous.notes}</p>
      )}

      {showNotes && (
        <textarea
          className="notes"
          aria-label="Nota"
          placeholder={mode === 'template' ? 'Nota: se copia en cada entreno' : (previous?.notes ?? 'Nota')}
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
        <span>{mode === 'template' ? 'Rango' : 'Anterior'}</span>
        <span>kg</span>
        <span>Reps</span>
        <span>{mode === 'template' ? '' : '✓'}</span>
      </div>
      {we.sets.map((s, si) => {
        const ph = placeholders[si]
        const fromPrevious = ph && previous?.sets.includes(ph) ? ph : undefined
        return (
          <Fragment key={si}>
            <div className={`set-grid set-row ${s.done ? 'done' : ''}`}>
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
              {mode === 'template' ? (
                <RangeInput
                  value={s.range}
                  onChange={(r) =>
                    onChange((x) => {
                      if (r) x.sets[si].range = r
                      else delete x.sets[si].range
                    })
                  }
                />
              ) : isPR(s, context) ? (
                <span className="prev pr-badge">
                  <Icon name="trophy" size={16} /> Récord
                </span>
              ) : (
                <span className="prev">
                  <span className="prev-values">{fromPrevious ? fmtSet(fromPrevious) : '—'}</span>
                  {s.range && <span className="prev-range">{fmtRange(s.range)} reps</span>}
                </span>
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
                placeholder={fmtNumber(ph?.reps) || (s.range ? fmtRange(s.range) : '')}
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
            <RestLine
              seconds={restAfter(s, we)}
              done={s.done}
              timerKey={restKey === undefined ? undefined : `${restKey}:${si}`}
              ariaLabel={`Descanso tras la serie ${labels[si]}`}
              onClick={() => void editRest(si)}
            />
          </Fragment>
        )
      })}
      <button
        className="btn ghost full"
        onClick={() =>
          onChange((x) => {
            x.sets.push(nextSet(x))
          })
        }
      >
        ＋ Añadir serie
      </button>
    </section>
  )
}

/**
 * The rest after a set, as in Strong: a line across the card with its time. While that rest is
 * running it becomes a bar that empties as the time passes, with the time left.
 */
function RestLine({
  seconds,
  done,
  timerKey,
  ariaLabel,
  onClick,
}: {
  seconds: number
  done: boolean
  timerKey?: string
  ariaLabel: string
  onClick: () => void
}) {
  const timer = useRestTimer()
  const running = timer !== null && timerKey !== undefined && timer.key === timerKey
  const now = useNow(250, running)
  if (running) {
    const remaining = Math.min(timer.total, Math.max(0, (timer.endsAt - now) / 1000))
    return (
      <button className="rest-line running" role="timer" aria-label={`Descanso: quedan ${fmtClock(remaining)}`} onClick={onClick}>
        <span className="rest-fill" style={{ width: `${(remaining / timer.total) * 100}%` }} />
        <span className="rest-time-left">{fmtClock(remaining)}</span>
      </button>
    )
  }
  return (
    <button
      className={`rest-line ${done ? 'done' : ''} ${seconds ? '' : 'zero'}`}
      aria-label={`${ariaLabel}: ${fmtRest(seconds)}`}
      onClick={onClick}
    >
      <span>{fmtRest(seconds)}</span>
    </button>
  )
}

/** Target reps of a template set, typed as "6-8" or "8". Invalid text goes back to the saved value. */
function RangeInput({ value, onChange }: { value?: RepRange; onChange: (r: RepRange | null) => void }) {
  const [text, setText] = useState<string | null>(null)
  return (
    <input
      className="cell-input range-input"
      aria-label="Rango de repeticiones"
      placeholder="—"
      value={text ?? (value ? fmtRange(value) : '')}
      onFocus={(e) => {
        setText(value ? (value[0] === value[1] ? String(value[0]) : `${value[0]}-${value[1]}`) : '')
        e.target.select()
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const r = parseRange(text ?? '')
        if (r !== undefined) onChange(r)
        setText(null)
      }}
    />
  )
}
