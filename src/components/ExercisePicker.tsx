import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { db, type Exercise } from '../db'
import { compareExercises, filterExercises, NO_FILTER, primaryText, type ExerciseFilter } from '../lib/exercises'
import { ExerciseFilters } from './ExerciseFilters'
import { ExerciseSheet } from './ExerciseSheet'
import { ExerciseTags } from './ExerciseTags'
import { CloseButton, Sheet } from './Sheet'

interface Props {
  onClose: () => void
  onPick: (exerciseIds: string[]) => void
  multiple?: boolean
  title?: string
  /** Stacking level of the sheet (one more than the sheet it opens from). */
  level?: number
}

export function ExercisePicker({ onClose, onPick, multiple = true, title = 'Añadir ejercicios', level = 2 }: Props) {
  const exercises = useLiveQuery(async () => (await db.exercises.toArray()).sort(compareExercises), [])
  const [filter, setFilter] = useState<ExerciseFilter>(NO_FILTER)
  const [selected, setSelected] = useState<string[]>([])
  const [creating, setCreating] = useState<Exercise | null>(null)

  const filtered = useMemo(() => filterExercises(exercises ?? [], filter), [exercises, filter])
  const query = filter.query.trim()

  function toggle(id: string) {
    if (!multiple) {
      onPick([id])
      return
    }
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  function startCreating() {
    setCreating({
      id: '',
      name: query,
      equipment: filter.equipment ?? undefined,
      primary: filter.muscle ? [filter.muscle] : undefined,
      createdAt: Date.now(),
    })
  }

  return (
    <Sheet
      level={level}
      label={title}
      title={title}
      left={<CloseButton onClick={onClose} />}
      right={
        multiple && (
          <button className="link strong" disabled={!selected.length} onClick={() => onPick(selected)}>
            Añadir{selected.length ? ` (${selected.length})` : ''}
          </button>
        )
      }
      onDismiss={onClose}
      toolbar={
        <div className="sheet-search exercise-search">
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
      }
    >
      <ul className="list card picker-list">
        {filtered.map((e) => (
          <li key={e.id}>
            <button
              className={`row exercise-row ${selected.includes(e.id) ? 'selected' : ''}`}
              aria-pressed={multiple ? selected.includes(e.id) : undefined}
              onClick={() => toggle(e.id)}
            >
              <span className="exercise-row-text">
                <span className="exercise-row-title">
                  {e.name} <ExerciseTags exercise={e} />
                </span>
                <small className={e.primary?.length ? 'muted' : 'missing'}>{primaryText(e) || 'Faltan los músculos'}</small>
              </span>
              {selected.includes(e.id) && <span className="check">✓</span>}
            </button>
          </li>
        ))}
        <li>
          <button className="row create-row" onClick={startCreating}>
            <span>＋ {query ? `Crear «${query}»` : 'Crear un ejercicio'}</span>
          </button>
        </li>
      </ul>
      {creating && (
        <ExerciseSheet
          exercise={creating}
          usage={0}
          level={level + 1}
          onClose={() => setCreating(null)}
          onSaved={(e) => {
            setFilter(NO_FILTER)
            toggle(e.id)
          }}
        />
      )}
    </Sheet>
  )
}
