import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { ExerciseSheet } from '../components/ExerciseSheet'
import { db, type Exercise } from '../db'
import { normalize } from '../lib/format'
import { useOpenSheet } from '../lib/sheets'
import { guessCategory } from '../seed'

export function ExercisesPage() {
  const openSheet = useOpenSheet()
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
                <button className="row" onClick={() => openSheet(`/exercises/${e.id}`)}>
                  <span>{e.name}</span>
                  <span className="muted small-text">{usage?.get(e.id) ?? 0}×</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {editing && (
        <ExerciseSheet exercise={editing} usage={usage?.get(editing.id) ?? 0} level={1} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}
