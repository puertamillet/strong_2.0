import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { db, newId } from '../db'
import { normalize } from '../lib/format'
import { guessCategory } from '../seed'
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
  const exercises = useLiveQuery(() => db.exercises.orderBy('name').toArray(), [])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])

  const filtered = useMemo(() => {
    const q = normalize(query.trim())
    return (exercises ?? []).filter((e) => !q || normalize(e.name).includes(q) || normalize(e.category ?? '').includes(q))
  }, [exercises, query])

  const exact = (exercises ?? []).some((e) => normalize(e.name) === normalize(query.trim()))

  function toggle(id: string) {
    if (!multiple) {
      onPick([id])
      return
    }
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  async function createExercise() {
    const name = query.trim()
    if (!name) return
    const id = newId()
    await db.exercises.add({ id, name, category: guessCategory(name), createdAt: Date.now() })
    setQuery('')
    toggle(id)
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
        <input
          className="search sheet-search"
          type="search"
          placeholder="Buscar ejercicio"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      }
    >
      <ul className="list card picker-list">
        {filtered.map((e) => (
          <li key={e.id}>
            <button className={`row ${selected.includes(e.id) ? 'selected' : ''}`} onClick={() => toggle(e.id)}>
              <span>
                {e.name}
                {e.category && <small className="muted"> · {e.category}</small>}
              </span>
              {selected.includes(e.id) && <span className="check">✓</span>}
            </button>
          </li>
        ))}
        {query.trim() && !exact && (
          <li>
            <button className="row create-row" onClick={createExercise}>
              <span>＋ Crear «{query.trim()}»</span>
            </button>
          </li>
        )}
      </ul>
    </Sheet>
  )
}
