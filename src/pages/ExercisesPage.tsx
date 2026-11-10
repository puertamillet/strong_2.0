import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { ExerciseFilters } from '../components/ExerciseFilters'
import { ExerciseSheet } from '../components/ExerciseSheet'
import { ExerciseTags } from '../components/ExerciseTags'
import { db, type Exercise } from '../db'
import { compareExercises, exerciseLabel, filterExercises, NO_FILTER, primaryText, type ExerciseFilter } from '../lib/exercises'
import { normalize } from '../lib/format'
import { useOpenSheet } from '../lib/sheets'

/** Exercises by their first letter, as in a phone's contacts. */
function byLetter(list: Exercise[]): [string, Exercise[]][] {
  const groups = new Map<string, Exercise[]>()
  for (const e of list) {
    const letter = normalize(exerciseLabel(e)).charAt(0).toUpperCase()
    const key = /[A-Z]/.test(letter) ? letter : '#'
    groups.set(key, [...(groups.get(key) ?? []), e])
  }
  return [...groups.entries()]
}

export function ExercisesPage() {
  const openSheet = useOpenSheet()
  const exercises = useLiveQuery(async () => (await db.exercises.toArray()).sort(compareExercises), [])
  const usage = useLiveQuery(async () => {
    const counts = new Map<string, number>()
    await db.workouts.each((w) => {
      for (const id of w.exerciseIds) counts.set(id, (counts.get(id) ?? 0) + 1)
    })
    return counts
  }, [])
  const [filter, setFilter] = useState<ExerciseFilter>(NO_FILTER)
  const [editing, setEditing] = useState<Exercise | null>(null)

  const list = useMemo(() => filterExercises(exercises ?? [], filter), [exercises, filter])
  const filtered = filter.group || filter.equipment || filter.query.trim()

  return (
    <div className="page">
      <header className="page-header">
        <h1>Ejercicios</h1>
        <button
          className="link strong"
          onClick={() =>
            setEditing({
              id: '',
              name: filter.query.trim(),
              equipment: filter.equipment ?? undefined,
              primary: filter.muscle ? [filter.muscle] : undefined,
              createdAt: Date.now(),
            })
          }
        >
          ＋ Nuevo
        </button>
      </header>
      <div className="exercise-search">
        <input
          className="search"
          type="search"
          placeholder="Buscar ejercicio"
          aria-label="Buscar ejercicio"
          value={filter.query}
          onChange={(e) => setFilter({ ...filter, query: e.target.value })}
        />
        <ExerciseFilters filter={filter} onChange={setFilter} />
      </div>
      {exercises && !list.length && (
        <div className="empty">
          <p>Ningún ejercicio coincide.</p>
          {filtered && (
            <button className="btn small" onClick={() => setFilter(NO_FILTER)}>
              Quitar filtros
            </button>
          )}
        </div>
      )}
      {byLetter(list).map(([letter, group]) => (
        <section key={letter}>
          <h2 className="group-title">{letter}</h2>
          <ul className="list card">
            {group.map((e) => (
              <li key={e.id}>
                <button className="row exercise-row" onClick={() => openSheet(`/exercises/${e.id}`)}>
                  <span className="exercise-row-text">
                    <span className="exercise-row-title">
                      {e.name} <ExerciseTags exercise={e} />
                    </span>
                    <small className={e.primary?.length ? 'muted' : 'missing'}>
                      {primaryText(e) || 'Faltan los músculos'}
                    </small>
                  </span>
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
