import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { askText, confirmDialog, notify } from '../lib/dialog'
import { ExerciseCard } from '../components/ExerciseCard'
import { ExercisePicker } from '../components/ExercisePicker'
import { RestTimerBar } from '../components/RestTimerBar'
import { CloseButton, MinimizeButton, Sheet } from '../components/Sheet'
import { db, type Workout } from '../db'
import { fmtClock } from '../lib/format'
import { useExerciseContexts, useExerciseMap } from '../lib/hooks'
import { restTimer, useRestTimer } from '../lib/restTimer'
import { useCloseSheet } from '../lib/sheets'
import { offerTemplateUpdate } from '../lib/templateUpdate'
import { useNow } from '../lib/useNow'
import {
  addExercisesToWorkout,
  countDoneSets,
  discardWorkout,
  finishWorkout,
  mutateWorkout,
  saveAsTemplate,
} from '../lib/workouts'
import { ExerciseDetail } from '../pages/ExerciseDetailPage'

/** /workout/:id — the workout in progress. A finished workout opens its summary instead. */
export function WorkoutRoute() {
  const { id = '' } = useParams()
  const location = useLocation()
  const close = useCloseSheet()
  const workout = useLiveQuery(() => db.workouts.get(id).then((w) => w ?? null), [id])

  if (workout === undefined) return null
  if (workout === null) {
    return (
      <Sheet label="Entreno" left={<CloseButton onClick={close} />} onDismiss={close}>
        <p className="empty">Este entreno ya no existe.</p>
      </Sheet>
    )
  }
  if (workout.endedAt !== null) return <Navigate to={`/history/${id}`} replace state={location.state} />
  return <ActiveWorkout workout={workout} />
}

export function Elapsed({ since }: { since: number }) {
  const now = useNow(1000)
  return <>{fmtClock((now - since) / 1000)}</>
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

function ActiveWorkout({ workout }: { workout: Workout }) {
  const minimize = useCloseSheet()
  const navigate = useNavigate()
  const location = useLocation()
  const exercises = useExerciseMap()
  const context = useExerciseContexts(workout.id, workout.exerciseIds, workout.startedAt)
  const timer = useRestTimer()
  // The template the workout was started from, if it still exists (null: none).
  const template = useLiveQuery(
    async () => (workout.templateId ? ((await db.templates.get(workout.templateId)) ?? null) : null),
    [workout.templateId],
  )
  const [picking, setPicking] = useState(false)
  const [detail, setDetail] = useState<string | null>(null)
  const id = workout.id
  const mutate = (fn: Parameters<typeof mutateWorkout>[1]) => void mutateWorkout(id, fn)

  async function discard() {
    await discardWorkout(id)
    restTimer.stop()
    minimize()
  }

  async function finish() {
    // As saved: a set ticked a moment ago may not have reached `workout` yet.
    const current = (await db.workouts.get(id)) ?? workout
    const total = current.exercises.reduce((n, e) => n + e.sets.length, 0)
    const done = countDoneSets(current)
    if (done === 0) {
      const cancel = await confirmDialog({
        title: 'No has marcado ninguna serie',
        message: 'Marca las series que hayas hecho para guardarlas, o cancela el entreno.',
        confirm: 'Cancelar entreno',
        cancel: 'Seguir entrenando',
        danger: true,
      })
      if (cancel) await discard()
      return
    }
    if (done < total) {
      const ok = await confirmDialog({
        title: '¿Terminar el entreno?',
        message: `${plural(total - done, 'serie sin marcar no se guardará', 'series sin marcar no se guardarán')}.`,
        confirm: 'Terminar',
        cancel: 'Seguir entrenando',
      })
      if (!ok) return
    }
    const from = current.templateId ? await db.templates.get(current.templateId) : undefined
    // The workout as it stands, before finishing drops the unticked sets.
    const snapshot = (await db.workouts.get(id)) ?? current
    const kept = await finishWorkout(id)
    restTimer.stop()
    if (!kept) {
      minimize()
      return
    }
    navigate(`/history/${id}`, { replace: true, state: location.state })
    // Like Strong: over the summary, ask whether the template takes today's changes.
    if (from) await offerTemplateUpdate(snapshot, from)
  }

  async function cancel() {
    const ok = await confirmDialog({
      title: '¿Cancelar el entreno?',
      message: 'Se perderá todo lo que has registrado en este entreno.',
      confirm: 'Cancelar entreno',
      cancel: 'Seguir entrenando',
      danger: true,
    })
    if (ok) await discard()
  }

  async function saveTemplate() {
    const name = await askText('Nombre de la plantilla', workout.name)
    if (!name) return
    await saveAsTemplate(workout, name)
    await notify('Plantilla guardada', `«${name}» ya está en tus plantillas.`)
  }

  return (
    <Sheet
      label="Entreno en curso"
      left={<MinimizeButton onClick={minimize} />}
      title={
        <span className="sheet-clock">
          <Elapsed since={workout.startedAt} />
        </span>
      }
      right={
        <button className="btn small finish" onClick={() => void finish()}>
          Terminar
        </button>
      }
      onDismiss={minimize}
      footer={timer ? <RestTimerBar /> : undefined}
    >
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

      {exercises &&
        workout.exercises.map((we, ei) => (
          <ExerciseCard
            key={`${we.exerciseId}-${ei}`}
            mode="active"
            restKey={`${id}:${ei}`}
            we={we}
            exercise={exercises.get(we.exerciseId)}
            context={context?.get(we.exerciseId)}
            isFirst={ei === 0}
            isLast={ei === workout.exercises.length - 1}
            onOpenExercise={setDetail}
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
        {/* A workout from a template updates it when finishing; only others are saved as new ones. */}
        {template === null && workout.exercises.length > 0 && (
          <button className="btn" onClick={() => void saveTemplate()}>
            Guardar como plantilla
          </button>
        )}
        <button className="btn danger" onClick={() => void cancel()}>
          Cancelar entreno
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
      {detail && <ExerciseDetail id={detail} level={2} onClose={() => setDetail(null)} />}
    </Sheet>
  )
}
