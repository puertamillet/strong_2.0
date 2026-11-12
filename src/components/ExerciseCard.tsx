import { useMemo, useState } from 'react'
import { restAfter, type Exercise, type RepRange, type SetType, type WorkoutExercise, type WorkoutSet } from '../db'
import { fmtClock, fmtNumber, fmtRange, fmtRest, fmtSet, parseRange, SET_TYPE_NAMES, setLabels } from '../lib/format'
import { haptic } from '../lib/haptics'
import { afterRemoving, restTimer, useRestTimer } from '../lib/restTimer'
import { useNow } from '../lib/useNow'
import { isPR, nextSet, type ExerciseContext } from '../lib/workouts'
import { askRange, confirmDialog, notify, pickDuration } from '../lib/dialog'
import { exerciseLabel } from '../lib/exercises'
import { ExerciseTags } from './ExerciseTags'
import { Icon } from './icons'
import { NumInput } from './NumInput'
import { SwipeToDelete } from './SwipeToDelete'

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

/** How long a deleted set takes to fold away (see .set-block.leaving). */
const FOLD_MS = 180

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
  const [showNote, setShowNote] = useState(Boolean(we.stickyNote))
  /** The set being deleted, while it folds away, until the list without it arrives (`length`: sets before). */
  const [leaving, setLeaving] = useState<{ index: number; length: number } | null>(null)
  // The list without it has arrived: nothing is folding any more.
  if (leaving && leaving.length !== we.sets.length) setLeaving(null)
  const folding = leaving && leaving.length === we.sets.length ? leaving.index : null
  const timer = useRestTimer()
  const placeholders = useMemo(() => placeholdersFor(we, previous), [we, previous])
  const labels = setLabels(we.sets)
  const name = exercise ? exerciseLabel(exercise) : 'Ejercicio eliminado'
  const timerKey = (si: number) => (restKey === undefined ? undefined : `${restKey}:${si}`)

  async function onAction(action: string) {
    switch (action) {
      case 'up':
        onMove(-1)
        break
      case 'down':
        onMove(1)
        break
      case 'note':
        setShowNote(true)
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
          haptic()
          onRemove()
        }
        break
    }
  }

  /**
   * Deletes a set: it folds away, and a rest running under a set below it moves up with it. It stays
   * folded until the list without it arrives (saving the workout takes a moment).
   */
  async function removeSet(si: number) {
    setLeaving({ index: si, length: we.sets.length })
    await new Promise((resolve) => setTimeout(resolve, FOLD_MS))
    if (restKey !== undefined) restTimer.follow(`${restKey}:`, afterRemoving(si))
    onChange((e) => {
      e.sets.splice(si, 1)
    })
  }

  /** No rest after the set (it can be given one again by tapping the line). If it was running, it stops. */
  function removeRest(si: number) {
    if (timer && timer.key !== undefined && timer.key === timerKey(si)) restTimer.stop()
    onChange((e) => {
      e.sets[si].rest = 0
    })
  }

  /** The set's target reps, typed in a dialog: from tapping them, or from the set's menu if it has none. */
  async function editRange(si: number) {
    const r = we.sets[si].range
    const text = await askRange('Rango de repeticiones', r ? (r[0] === r[1] ? `${r[0]}` : `${r[0]}-${r[1]}`) : '', `${name} · serie ${labels[si]}`)
    if (text === null) return
    const range = parseRange(text)
    if (range === undefined) {
      await notify('Rango no válido', 'Escribe las repeticiones como «8» o «6-8».')
      return
    }
    onChange((e) => {
      if (range) e.sets[si].range = range
      else delete e.sets[si].range
    })
  }

  /** The set's menu: its kind, its target reps or deleting it. */
  async function onSetMenu(si: number, value: string) {
    if (value === 'delete') {
      haptic()
      await removeSet(si)
    } else if (value === 'range') {
      await editRange(si)
    } else {
      onChange((e) => {
        e.sets[si].type = value as SetType
      })
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
      haptic()
      onChange((e) => {
        e.sets[si].done = false
      })
      return
    }
    const ph = placeholders[si]
    const weight = set.weight ?? ph?.weight ?? null
    const reps = set.reps ?? ph?.reps ?? null
    if (reps === null) return
    haptic()
    onChange((e) => {
      const s = e.sets[si]
      s.weight = weight
      s.reps = reps
      s.done = true
    })
    if (mode === 'active') {
      const seconds = restAfter(set, we)
      if (seconds > 0) restTimer.start(seconds, timerKey(si))
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
            {!showNote && <option value="note">Añadir nota</option>}
            <option value="rests">Cambiar todos los descansos</option>
            {!isFirst && <option value="up">Mover arriba</option>}
            {!isLast && <option value="down">Mover abajo</option>}
            <option value="remove">Quitar ejercicio</option>
          </select>
        </label>
      </div>

      {showNote && (
        <SwipeToDelete
          className="note-swipe"
          label="Borrar la nota"
          onDelete={() => {
            onChange((x) => {
              delete x.stickyNote
            })
            setShowNote(false)
          }}
        >
          <textarea
            className="sticky-note"
            aria-label="Nota"
            placeholder="Nota: se ve siempre con el ejercicio"
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
            onBlur={(e) => {
              // What is written now: the saved note may not have come back yet.
              if (!e.target.value.trim()) setShowNote(false)
            }}
          />
        </SwipeToDelete>
      )}

      <div className="set-grid set-grid-head">
        <span>Serie</span>
        <span>{mode === 'template' ? 'Rango' : 'Anterior'}</span>
        <span>kg</span>
        <span>Reps</span>
        <span>{mode === 'template' ? '' : '✓'}</span>
      </div>
      <div className="set-list">
        {we.sets.map((s, si) => {
          const ph = placeholders[si]
          const fromPrevious = ph && previous?.sets.includes(ph) ? ph : undefined
          const rest = restAfter(s, we)
          return (
            <div key={si} className={`set-block ${folding === si ? 'leaving' : ''}`}>
              <div className="set-block-clip">
                <div className="set-block-body">
                  <SwipeToDelete label={`Borrar la serie ${labels[si]}`} onDelete={() => removeSet(si)}>
                    <div className={`set-grid set-row ${s.done ? 'done' : ''}`}>
                      <label className={`set-type type-${s.type}`}>
                        {labels[si]}
                        <select value={s.type} aria-label="Tipo de serie" onChange={(e) => void onSetMenu(si, e.target.value)}>
                          {(Object.keys(SET_TYPE_NAMES) as SetType[]).map((t) => (
                            <option key={t} value={t}>
                              {SET_TYPE_NAMES[t]}
                            </option>
                          ))}
                          {mode !== 'template' && <option value="range">Rango de reps…</option>}
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
                          {s.range && (
                            <button
                              className="prev-range"
                              aria-label={`Rango de repeticiones de la serie ${labels[si]}: ${fmtRange(s.range)}. Cambiar`}
                              onClick={() => void editRange(si)}
                            >
                              {fmtRange(s.range)} reps
                            </button>
                          )}
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
                          onClick={() => {
                            haptic()
                            void removeSet(si)
                          }}
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
                  </SwipeToDelete>
                  <SwipeToDelete
                    label={`Quitar el descanso tras la serie ${labels[si]}`}
                    disabled={rest === 0}
                    onDelete={() => removeRest(si)}
                  >
                    <RestLine
                      seconds={rest}
                      done={s.done}
                      timerKey={timerKey(si)}
                      ariaLabel={`Descanso tras la serie ${labels[si]}`}
                      onClick={() => void editRest(si)}
                    />
                  </SwipeToDelete>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <button
        className="btn ghost full"
        onClick={() => {
          haptic()
          onChange((x) => {
            x.sets.push(nextSet(x))
          })
        }}
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
