import { Fragment, useMemo, useState } from 'react'
import {
  restAfter,
  restBetweenSides,
  type Exercise,
  type RepRange,
  type SetType,
  type WorkoutExercise,
  type WorkoutSet,
} from '../db'
import { fmtClock, fmtNumber, fmtRange, fmtSet, parseRange, SET_TYPE_NAMES, setLabels } from '../lib/format'
import { restTimer } from '../lib/restTimer'
import { isPR, nextSet, type ExerciseContext } from '../lib/workouts'
import { confirmDialog, pickDuration } from '../lib/dialog'
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

function withoutSides(s: WorkoutSet): WorkoutSet {
  const copy = { ...s }
  delete copy.sides
  delete copy.sideRest
  delete copy.second
  delete copy.firstDone
  return copy
}

export function ExerciseCard({ we, exercise, context, mode, isFirst, isLast, onChange, onMove, onRemove, onOpenExercise }: CardProps) {
  const previous = context?.last
  const [showNotes, setShowNotes] = useState(Boolean(we.notes))
  const [showSticky, setShowSticky] = useState(Boolean(we.stickyNote))
  const placeholders = useMemo(() => placeholdersFor(we, previous), [we, previous])
  const labels = setLabels(we.sets)
  const name = exercise?.name ?? 'Ejercicio eliminado'
  const unilateral = we.sets.some((s) => s.sides === 2)
  const allRest = sharedRest(we)

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
      case 'sides':
        onChange((e) => {
          e.sets = e.sets.map((s) => (unilateral ? withoutSides(s) : { ...s, sides: 2 }))
        })
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

  async function editAllRests() {
    const v = await pickDuration('Descanso de todas las series', allRest ?? we.restSeconds, { message: name })
    if (v === null) return
    onChange((e) => {
      e.restSeconds = v
      for (const s of e.sets) delete s.rest
    })
  }

  async function editRest(si: number, betweenSides: boolean) {
    const s = we.sets[si]
    const current = betweenSides ? restBetweenSides(s, we) : restAfter(s, we)
    const title = betweenSides ? 'Descanso entre lados' : 'Descanso'
    const v = await pickDuration(title, current, { message: `${name} · serie ${labels[si]}` })
    if (v === null) return
    onChange((e) => {
      if (betweenSides) e.sets[si].sideRest = v
      else e.sets[si].rest = v
    })
  }

  /** Ticks a set, or one side of a unilateral set (the set is done with the second side). */
  function toggleDone(si: number) {
    const set = we.sets[si]
    if (set.done) {
      onChange((e) => {
        e.sets[si].done = false
        delete e.sets[si].firstDone
      })
      return
    }
    const ph = placeholders[si]
    const weight = set.weight ?? ph?.weight ?? null
    const reps = set.reps ?? ph?.reps ?? null
    if (reps === null) return
    const finishing = set.sides !== 2 || Boolean(set.firstDone)
    onChange((e) => {
      const s = e.sets[si]
      s.weight = weight
      s.reps = reps
      if (s.second) s.second = { weight: s.second.weight ?? weight, reps: s.second.reps ?? reps }
      if (finishing) {
        s.done = true
        delete s.firstDone
      } else {
        s.firstDone = true
      }
    })
    if (mode === 'active') {
      const seconds = finishing ? restAfter(set, we) : restBetweenSides(set, we)
      if (seconds > 0) restTimer.start(seconds)
    }
  }

  function checkLabel(s: WorkoutSet): string {
    if (s.done) return 'Desmarcar serie'
    if (s.sides !== 2) return 'Marcar serie'
    return s.firstDone ? 'Marcar el segundo lado' : 'Marcar el primer lado'
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
            {!showSticky && <option value="sticky">Añadir nota fija</option>}
            {!showNotes && <option value="notes">Añadir nota</option>}
            <option value="sides">{unilateral ? 'Hacerlo bilateral' : 'Hacerlo unilateral (por lados)'}</option>
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

      <div className="exercise-meta">
        <button className="select-chip" onClick={() => void editAllRests()} aria-label="Descanso de todas las series">
          <Icon name="timer" size={16} /> {allRest === null ? 'Varios' : allRest ? fmtClock(allRest) : 'Sin descanso'}
        </button>
        {unilateral && <span className="tag">Unilateral</span>}
        {!showNotes && previous?.notes && mode !== 'template' && (
          <span className="muted small-text">Nota anterior: {previous.notes}</span>
        )}
      </div>

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
        const twoSided = s.sides === 2
        const state = s.done ? 'done' : s.firstDone ? 'half' : ''
        return (
          <Fragment key={si}>
            <div className={`set-grid set-row ${state}`}>
              <label className={`set-type type-${s.type}`}>
                {labels[si]}
                <select
                  value={s.type}
                  aria-label="Tipo de serie"
                  onChange={(e) => {
                    const v = e.target.value
                    onChange((x) => {
                      const set = x.sets[si]
                      if (v === 'delete') x.sets.splice(si, 1)
                      else if (v === 'second') {
                        if (set.second) delete set.second
                        else set.second = { weight: set.weight, reps: set.reps }
                      } else set.type = v as SetType
                    })
                  }}
                >
                  {(Object.keys(SET_TYPE_NAMES) as SetType[]).map((t) => (
                    <option key={t} value={t}>
                      {SET_TYPE_NAMES[t]}
                    </option>
                  ))}
                  {twoSided && (
                    <option value="second">{s.second ? 'Mismos valores en los dos lados' : 'Valores distintos por lado'}</option>
                  )}
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
                <button className={`check-btn ${state === 'done' ? 'on' : state}`} aria-label={checkLabel(s)} onClick={() => toggleDone(si)}>
                  ✓
                </button>
              )}
            </div>
            {twoSided && s.second && (
              <div className={`set-grid set-row second-row ${state}`}>
                <span className="side-label">2º lado</span>
                <span />
                <NumInput
                  className="cell-input"
                  ariaLabel="Peso del segundo lado"
                  value={s.second.weight}
                  placeholder={fmtNumber(s.weight)}
                  onChange={(v) =>
                    onChange((x) => {
                      x.sets[si].second = { weight: v, reps: x.sets[si].second?.reps ?? null }
                    })
                  }
                />
                <NumInput
                  className="cell-input"
                  ariaLabel="Repeticiones del segundo lado"
                  decimal={false}
                  value={s.second.reps}
                  placeholder={fmtNumber(s.reps)}
                  onChange={(v) =>
                    onChange((x) => {
                      x.sets[si].second = { weight: x.sets[si].second?.weight ?? null, reps: v }
                    })
                  }
                />
                <span />
              </div>
            )}
            <div className="rest-row">
              {twoSided && (
                <RestChip
                  seconds={restBetweenSides(s, we)}
                  label="entre lados"
                  ariaLabel={`Descanso entre lados de la serie ${labels[si]}`}
                  onClick={() => void editRest(si, true)}
                />
              )}
              <RestChip seconds={restAfter(s, we)} ariaLabel={`Descanso tras la serie ${labels[si]}`} onClick={() => void editRest(si, false)} />
            </div>
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

function RestChip({ seconds, label, ariaLabel, onClick }: { seconds: number; label?: string; ariaLabel: string; onClick: () => void }) {
  return (
    <button className={`rest-chip ${seconds ? '' : 'zero'}`} aria-label={`${ariaLabel}: ${fmtClock(seconds)}`} onClick={onClick}>
      {label ?? <Icon name="timer" size={14} />} {fmtClock(seconds)}
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
