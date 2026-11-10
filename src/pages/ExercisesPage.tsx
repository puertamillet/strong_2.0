import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { db, DEFAULT_REST_SECONDS, newId, REST_OPTIONS, type Exercise } from '../db'
import { fmtClock, normalize } from '../lib/format'
import { guessCategory, SEED_EXERCISES } from '../seed'

const CATEGORIES = Object.keys(SEED_EXERCISES)
export function ExercisesPage() {
  const exercises = useLiveQuery(() => db.exercises.orderBy('name').toArray(), [])
  const usage = useLiveQuery(async () => {
    const counts = new Map<string, number>()
    await db.workouts.each((w) => {
      for (const id of w.exerciseIds) counts.set(id, (counts.get(id) ?? 0) + 1)
    })
    return counts
  }, [])
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Exercise | null>(null)

  const groups = useMemo(() => {
    const q = normalize(query.trim())
    const map = new Map<string, Exercise[]>()
    for (const e of exercises ?? []) {
      if (q && !normalize(e.name).includes(q)) continue
      const c = e.category || 'Otros'
      map.set(c, [...(map.get(c) ?? []), e])
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, 'es'))
  }, [exercises, query])

  return (
    <div className="page">
      <header className="page-header">
        <h1>Ejercicios</h1>
        <button
          className="link strong"
          onClick={() => setEditing({ id: '', name: query.trim(), category: guessCategory(query), createdAt: Date.now() })}
        >
          ＋ Nuevo
        </button>
      </header>
      <input
        className="search"
        type="search"
        placeholder="Buscar ejercicio"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {groups.map(([category, list]) => (
        <section key={category}>
          <h2 className="group-title">{category}</h2>
          <ul className="list card">
            {list.map((e) => (
              <li key={e.id}>
                <button className="row" onClick={() => setEditing(e)}>
                  <span>{e.name}</span>
                  <span className="muted small-text">{usage?.get(e.id) ?? 0}×</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {editing && (
        <ExerciseSheet exercise={editing} usage={usage?.get(editing.id) ?? 0} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

function ExerciseSheet({ exercise, usage, onClose }: { exercise: Exercise; usage: number; onClose: () => void }) {
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
