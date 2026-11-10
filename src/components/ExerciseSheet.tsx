import { useState } from 'react'
import { db, DEFAULT_REST_SECONDS, newId, REST_OPTIONS, type Exercise } from '../db'
import { fmtClock } from '../lib/format'
import { SEED_EXERCISES } from '../seed'
import { isUnilateral } from '../lib/catalog'
import { confirmDialog, notify } from '../lib/dialog'
import { CloseButton, Sheet } from './Sheet'

const CATEGORIES = Object.keys(SEED_EXERCISES)

interface Props {
  exercise: Exercise
  /** Number of workouts using the exercise (it can't be deleted while used). */
  usage: number
  onClose: () => void
  onDeleted?: () => void
  level?: number
}

/** Sheet to create or edit an exercise. A blank `id` means "new". */
export function ExerciseSheet({ exercise, usage, onClose, onDeleted, level = 2 }: Props) {
  const [draft, setDraft] = useState(exercise)
  const isNew = !exercise.id

  async function save() {
    const name = draft.name.trim()
    if (!name) return
    const clash = await db.exercises.where('name').equals(name).first()
    if (clash && clash.id !== exercise.id) {
      await notify('Ya existe un ejercicio con ese nombre')
      return
    }
    await db.exercises.put({ ...draft, name, id: draft.id || newId() })
    onClose()
  }

  async function remove() {
    if (usage > 0) {
      await notify('No se puede eliminar', `Aparece en ${usage} ${usage === 1 ? 'entreno' : 'entrenos'}.`)
      return
    }
    if (!(await confirmDialog({ title: `¿Eliminar «${exercise.name}»?`, confirm: 'Eliminar', danger: true }))) return
    await db.exercises.delete(exercise.id)
    onClose()
    onDeleted?.()
  }

  async function close() {
    if (JSON.stringify(draft) !== JSON.stringify(exercise)) {
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

  return (
    <Sheet
      level={level}
      label={isNew ? 'Nuevo ejercicio' : 'Editar ejercicio'}
      title={isNew ? 'Nuevo ejercicio' : 'Editar ejercicio'}
      left={<CloseButton onClick={() => void close()} />}
      right={
        <button className="link strong" onClick={save}>
          Guardar
        </button>
      }
    >
      <div className="form">
        <label>
          Nombre
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label>
          Grupo muscular
          <select
            value={draft.category ?? ''}
            onChange={(e) => setDraft({ ...draft, category: e.target.value || undefined })}
          >
            <option value="">Otros</option>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Lateralidad
          <select
            value={isUnilateral(draft) ? 'Unilateral' : 'Bilateral'}
            onChange={(e) => setDraft({ ...draft, laterality: e.target.value as 'Bilateral' | 'Unilateral' })}
          >
            <option value="Bilateral">Bilateral</option>
            <option value="Unilateral">Unilateral (un lado cada vez)</option>
          </select>
        </label>
        <label>
          Descanso por defecto
          <select
            value={draft.defaultRestSeconds ?? DEFAULT_REST_SECONDS}
            onChange={(e) => setDraft({ ...draft, defaultRestSeconds: Number(e.target.value) })}
          >
            {REST_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s ? fmtClock(s) : 'Sin descanso'}
              </option>
            ))}
          </select>
        </label>
        <label>
          Notas
          <textarea
            value={draft.notes ?? ''}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value || undefined })}
          />
        </label>
        {!isNew && (
          <button className="btn danger" onClick={remove}>
            Eliminar ejercicio
          </button>
        )}
      </div>
    </Sheet>
  )
}
