import { useState } from 'react'
import { db, DEFAULT_REST_SECONDS, newId, REST_OPTIONS, type Exercise } from '../db'
import { fmtClock } from '../lib/format'
import { SEED_EXERCISES } from '../seed'

const CATEGORIES = Object.keys(SEED_EXERCISES)

interface Props {
  exercise: Exercise
  /** Number of workouts using the exercise (it can't be deleted while used). */
  usage: number
  onClose: () => void
  onDeleted?: () => void
}

/** Bottom sheet to create or edit an exercise. A blank `id` means "new". */
export function ExerciseSheet({ exercise, usage, onClose, onDeleted }: Props) {
  const [draft, setDraft] = useState(exercise)
  const isNew = !exercise.id

  async function save() {
    const name = draft.name.trim()
    if (!name) return
    const clash = await db.exercises.where('name').equals(name).first()
    if (clash && clash.id !== exercise.id) {
      alert('Ya existe un ejercicio con ese nombre.')
      return
    }
    await db.exercises.put({ ...draft, name, id: draft.id || newId() })
    onClose()
  }

  async function remove() {
    if (usage > 0) {
      alert(`No se puede eliminar: aparece en ${usage} entrenos.`)
      return
    }
    if (!confirm(`¿Eliminar «${exercise.name}»?`)) return
    await db.exercises.delete(exercise.id)
    onClose()
    onDeleted?.()
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <button className="link" onClick={onClose}>
            Cancelar
          </button>
          <strong>{isNew ? 'Nuevo ejercicio' : 'Editar ejercicio'}</strong>
          <button className="link strong" onClick={save}>
            Guardar
          </button>
        </div>
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
      </div>
    </div>
  )
}
