import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Navigate, useLocation, useParams } from 'react-router-dom'
import { askText, confirmDialog, notify } from '../lib/dialog'
import { ExerciseCard } from '../components/ExerciseCard'
import { ExercisePicker } from '../components/ExercisePicker'
import { ExerciseTags } from '../components/ExerciseTags'
import { Icon } from '../components/icons'
import { CloseButton, Sheet } from '../components/Sheet'
import { db, type Exercise, type Workout, type WorkoutExercise } from '../db'
import { fmtDate, fmtDuration, fmtInt, fmtNumber, fmtSet, setLabels } from '../lib/format'
import { useExerciseContexts, useExerciseMap } from '../lib/hooks'
import { useCloseSheet } from '../lib/sheets'
import { volume } from '../lib/stats'
import {
  discardWorkout,
  estimated1RM,
  isPR,
  newWorkoutExercises,
  saveAsTemplate,
  saveWorkout,
  type ExerciseContext,
} from '../lib/workouts'
import { ExerciseDetail } from '../pages/ExerciseDetailPage'

/** /history/:id — a finished workout: what was done, records, and Editar. */
export function WorkoutSummaryRoute() {
  const { id = '' } = useParams()
  const location = useLocation()
  const close = useCloseSheet()
  const workout = useLiveQuery(() => db.workouts.get(id).then((w) => w ?? null), [id])
  // The template the workout was started from, if it still exists (null: none).
  const template = useLiveQuery(
    async () => (workout?.templateId ? ((await db.templates.get(workout.templateId)) ?? null) : null),
    [workout?.templateId],
  )
  const exercises = useExerciseMap()
  const context = useExerciseContexts(id, workout?.exerciseIds ?? [], workout?.startedAt ?? 0)
  const [editing, setEditing] = useState(false)
  const [detail, setDetail] = useState<string | null>(null)

  if (workout?.endedAt === null) return <Navigate to={`/workout/${id}`} replace state={location.state} />

  const records = workout
    ? workout.exercises.reduce((n, e) => n + e.sets.filter((s) => isPR(s, context?.get(e.exerciseId))).length, 0)
    : 0

  async function saveTemplate(w: Workout) {
    const name = await askText('Nombre de la plantilla', w.name)
    if (!name) return
    await saveAsTemplate(w, name)
    await notify('Plantilla guardada', `«${name}» ya está en tus plantillas.`)
  }

  return (
    <Sheet
      label="Entreno"
      left={<CloseButton onClick={close} />}
      right={
        workout && (
          <button className="link strong" onClick={() => setEditing(true)}>
            Editar
          </button>
        )
      }
      onDismiss={close}
    >
      {workout === undefined ? null : workout === null ? (
        <p className="empty">Este entreno ya no existe.</p>
      ) : (
        <>
          <div>
            <h1 className="sheet-heading">{workout.name}</h1>
            <p className="muted small-text">{fmtDate(workout.startedAt)}</p>
          </div>
          <div className="stat-row">
            <div className="card stat">
              <span className="stat-label">Duración</span>
              <span className="stat-value">{fmtDuration((workout.endedAt ?? workout.startedAt) - workout.startedAt)}</span>
            </div>
            <div className="card stat">
              <span className="stat-label">Tonelaje</span>
              <span className="stat-value">{fmtInt(volume(workout))} kg</span>
            </div>
            <div className="card stat">
              <span className="stat-label">Récords</span>
              <span className="stat-value">{records}</span>
            </div>
          </div>
          {workout.notes && <p className="card">{workout.notes}</p>}
          {workout.exercises.map((e, i) => (
            <SummaryExercise
              key={i}
              we={e}
              exercise={exercises?.get(e.exerciseId)}
              context={context?.get(e.exerciseId)}
              onOpen={() => setDetail(e.exerciseId)}
            />
          ))}
          {/* A workout from a template already offered to update it when finishing. */}
          {template === null && (
            <div className="stack">
              <button className="btn" onClick={() => void saveTemplate(workout)}>
                Guardar como plantilla
              </button>
            </div>
          )}
          {editing && <EditWorkout workout={workout} onClose={() => setEditing(false)} onDeleted={close} />}
        </>
      )}
      {detail && <ExerciseDetail id={detail} level={2} onClose={() => setDetail(null)} />}
    </Sheet>
  )
}

const kg = (v: number) => `${fmtNumber(Math.round(v * 10) / 10)} kg`

function SummaryExercise({
  we,
  exercise,
  context,
  onOpen,
}: {
  we: WorkoutExercise
  exercise?: Exercise
  context?: ExerciseContext
  onOpen: () => void
}) {
  const labels = setLabels(we.sets)
  return (
    <section className="card summary-exercise">
      <button className="exercise-link" onClick={onOpen}>
        <h3>{exercise?.name ?? 'Ejercicio eliminado'}</h3>
        {exercise && <ExerciseTags exercise={exercise} />}
      </button>
      {we.stickyNote && <p className="sticky-note pre-line">{we.stickyNote}</p>}
      <ul className="session-sets">
        {we.sets.map((s, i) => (
          <li key={i}>
            <span className={`set-tag type-${s.type}`}>{labels[i]}</span>
            <span>{fmtSet(s)}</span>
            {isPR(s, context) && (
              <span className="pr-badge">
                <Icon name="trophy" size={14} /> Récord
              </span>
            )}
            {s.type !== 'warmup' && s.weight && s.reps ? (
              <span className="muted set-e1rm">1RM {kg(estimated1RM(s.weight, s.reps))}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Editing a past workout, on a sheet over its summary. Nothing is saved until Guardar. */
function EditWorkout({ workout, onClose, onDeleted }: { workout: Workout; onClose: () => void; onDeleted: () => void }) {
  const [original] = useState(() => JSON.stringify(workout))
  const [draft, setDraft] = useState<Workout>(() => structuredClone(workout))
  const exercises = useExerciseMap()
  const context = useExerciseContexts(workout.id, draft.exerciseIds, workout.startedAt)
  const [picking, setPicking] = useState(false)
  const [detail, setDetail] = useState<string | null>(null)

  const update = (fn: (w: Workout) => void) =>
    setDraft((d) => {
      const copy = structuredClone(d)
      fn(copy)
      copy.exerciseIds = [...new Set(copy.exercises.map((e) => e.exerciseId))]
      return copy
    })

  async function close() {
    if (JSON.stringify(draft) !== original) {
      const discard = await confirmDialog({
        title: '¿Descartar los cambios?',
        confirm: 'Descartar cambios',
        cancel: 'Seguir editando',
        danger: true,
      })
      if (!discard) return
    }
    onClose()
  }

  async function save() {
    const unticked = draft.exercises.reduce((n, e) => n + e.sets.filter((s) => !s.done).length, 0)
    if (unticked > 0) {
      const ok = await confirmDialog({
        title: '¿Guardar el entreno?',
        message: `${unticked} ${unticked === 1 ? 'serie sin marcar no se guardará' : 'series sin marcar no se guardarán'}.`,
        confirm: 'Guardar',
        cancel: 'Seguir editando',
      })
      if (!ok) return
    }
    if (!(await saveWorkout(draft))) {
      await notify('No queda ninguna serie', 'Marca alguna serie, o elimina el entreno.')
      return
    }
    onClose()
  }

  async function remove() {
    const ok = await confirmDialog({
      title: '¿Eliminar este entreno?',
      message: 'Se borrará del historial.',
      confirm: 'Eliminar entreno',
      danger: true,
    })
    if (!ok) return
    await discardWorkout(workout.id)
    onDeleted()
  }

  return (
    <Sheet
      level={2}
      label="Editar entreno"
      title="Editar entreno"
      left={<CloseButton onClick={() => void close()} />}
      right={
        <button className="link strong" onClick={() => void save()}>
          Guardar
        </button>
      }
    >
      <input
        className="title-input"
        value={draft.name}
        aria-label="Nombre del entreno"
        onChange={(e) => {
          const name = e.target.value
          update((w) => {
            w.name = name
          })
        }}
      />
      {exercises &&
        draft.exercises.map((we, ei) => (
          <ExerciseCard
            key={`${we.exerciseId}-${ei}`}
            mode="edit"
            we={we}
            exercise={exercises.get(we.exerciseId)}
            context={context?.get(we.exerciseId)}
            isFirst={ei === 0}
            isLast={ei === draft.exercises.length - 1}
            onOpenExercise={setDetail}
            onChange={(fn) =>
              update((w) => {
                fn(w.exercises[ei])
              })
            }
            onMove={(dir) =>
              update((w) => {
                const [item] = w.exercises.splice(ei, 1)
                w.exercises.splice(ei + dir, 0, item)
              })
            }
            onRemove={() =>
              update((w) => {
                w.exercises.splice(ei, 1)
              })
            }
          />
        ))}
      <div className="stack">
        <button className="btn primary-outline" onClick={() => setPicking(true)}>
          Añadir ejercicios
        </button>
        <button className="btn danger" onClick={() => void remove()}>
          Eliminar entreno
        </button>
      </div>
      {picking && (
        <ExercisePicker
          level={3}
          onClose={() => setPicking(false)}
          onPick={async (ids) => {
            setPicking(false)
            const added = await newWorkoutExercises(ids, workout.id)
            update((w) => {
              w.exercises.push(...added)
            })
          }}
        />
      )}
      {detail && <ExerciseDetail id={detail} level={3} onClose={() => setDetail(null)} />}
    </Sheet>
  )
}
