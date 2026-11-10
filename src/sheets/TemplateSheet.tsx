import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { confirmDialog, notify } from '../lib/dialog'
import { ExerciseCard } from '../components/ExerciseCard'
import { ExercisePicker } from '../components/ExercisePicker'
import { CloseButton, Sheet } from '../components/Sheet'
import { db, newId, type Template, type WorkoutExercise } from '../db'
import { useExerciseContexts, useExerciseMap } from '../lib/hooks'
import { useCloseSheet } from '../lib/sheets'
import { fromTemplateExercise, newWorkoutExercises, templateExercise } from '../lib/workouts'
import { ExerciseDetail } from '../pages/ExerciseDetailPage'

/** /templates/:id — create (id "new") or edit a template. */
export function TemplateRoute() {
  const { id = 'new' } = useParams()
  // Remount when the id changes so the draft starts fresh.
  return <TemplateEditor key={id} id={id} />
}

/** The template being edited, in the same shape as a workout so it can use the same cards. */
interface Draft {
  template: Template
  name: string
  exercises: WorkoutExercise[]
}

function toDraft(t: Template): Draft {
  return {
    template: t,
    name: t.name,
    exercises: t.exercises.map(fromTemplateExercise),
  }
}

function snapshot(d: Draft) {
  return JSON.stringify([d.name, d.exercises])
}

function TemplateEditor({ id }: { id: string }) {
  const close = useCloseSheet()
  const isNew = id === 'new'
  const [draft, setDraft] = useState<Draft | null | undefined>(() =>
    isNew ? toDraft({ id: newId(), name: '', exercises: [], updatedAt: Date.now() }) : undefined,
  )
  const [original, setOriginal] = useState(() => (draft ? snapshot(draft) : ''))
  const [now] = useState(Date.now)
  const exercises = useExerciseMap()
  const context = useExerciseContexts('', draft?.exercises.map((e) => e.exerciseId) ?? [], now)
  const [picking, setPicking] = useState(false)
  const [detail, setDetail] = useState<string | null>(null)

  useEffect(() => {
    if (isNew) return
    void db.templates.get(id).then((t) => {
      const d = t ? toDraft(t) : null
      setDraft(d)
      setOriginal(d ? snapshot(d) : '')
    })
  }, [id, isNew])

  const update = (fn: (d: Draft) => void) =>
    setDraft((d) => {
      if (!d) return d
      const copy = structuredClone(d)
      fn(copy)
      return copy
    })

  async function onClose() {
    if (draft && snapshot(draft) !== original) {
      const discard = await confirmDialog({
        title: '¿Descartar los cambios?',
        confirm: 'Descartar cambios',
        cancel: 'Seguir editando',
        danger: true,
      })
      if (!discard) return
    }
    close()
  }

  async function save() {
    if (!draft) return
    const name = draft.name.trim()
    if (!name) {
      await notify('Ponle un nombre a la plantilla')
      return
    }
    await db.templates.put({
      ...draft.template,
      name,
      updatedAt: Date.now(),
      // In the editor, the exercise's note is the template's note (copied into each workout).
      exercises: draft.exercises.map((e) => templateExercise(e, e.notes)),
    })
    close()
  }

  async function remove() {
    if (!draft) return
    const ok = await confirmDialog({
      title: `¿Eliminar la plantilla «${draft.name}»?`,
      message: 'Los entrenos que hiciste con ella se quedan en el historial.',
      confirm: 'Eliminar plantilla',
      danger: true,
    })
    if (!ok) return
    await db.templates.delete(draft.template.id)
    close()
  }

  const title = isNew ? 'Nueva plantilla' : 'Editar plantilla'
  return (
    <Sheet
      label={title}
      title={title}
      left={<CloseButton onClick={() => void onClose()} />}
      right={
        draft && (
          <button className="link strong" onClick={() => void save()}>
            Guardar
          </button>
        )
      }
    >
      {draft === undefined ? null : draft === null ? (
        <p className="empty">Esta plantilla ya no existe.</p>
      ) : (
        <>
          <input
            className="title-input"
            placeholder="Nombre de la plantilla"
            aria-label="Nombre de la plantilla"
            value={draft.name}
            onChange={(e) => {
              const v = e.target.value
              update((d) => {
                d.name = v
              })
            }}
          />
          {exercises &&
            draft.exercises.map((we, ei) => (
              <ExerciseCard
                key={`${we.exerciseId}-${ei}`}
                mode="template"
                we={we}
                exercise={exercises.get(we.exerciseId)}
                context={context?.get(we.exerciseId)}
                isFirst={ei === 0}
                isLast={ei === draft.exercises.length - 1}
                onOpenExercise={setDetail}
                onChange={(fn) =>
                  update((d) => {
                    fn(d.exercises[ei])
                  })
                }
                onMove={(dir) =>
                  update((d) => {
                    const [item] = d.exercises.splice(ei, 1)
                    d.exercises.splice(ei + dir, 0, item)
                  })
                }
                onRemove={() =>
                  update((d) => {
                    d.exercises.splice(ei, 1)
                  })
                }
              />
            ))}
          <div className="stack">
            <button className="btn primary-outline" onClick={() => setPicking(true)}>
              Añadir ejercicios
            </button>
            {!isNew && (
              <button className="btn danger" onClick={() => void remove()}>
                Eliminar plantilla
              </button>
            )}
          </div>
        </>
      )}
      {picking && (
        <ExercisePicker
          onClose={() => setPicking(false)}
          onPick={async (ids) => {
            setPicking(false)
            const added = await newWorkoutExercises(ids)
            update((d) => {
              d.exercises.push(...added)
            })
          }}
        />
      )}
      {detail && <ExerciseDetail id={detail} level={2} onClose={() => setDetail(null)} />}
    </Sheet>
  )
}
