import { useState } from 'react'
import { db, DEFAULT_REST_SECONDS, newId, REST_OPTIONS, type Exercise } from '../db'
import { EQUIPMENT, LATERALITY, MUSCLE_GROUP_NAMES, MUSCLE_GROUPS, type Equipment, type Muscle } from '../lib/catalog'
import { confirmDialog, notify } from '../lib/dialog'
import { exerciseKey, exerciseLabel, missingFields } from '../lib/exercises'
import { fmtClock } from '../lib/format'
import { CloseButton, Sheet } from './Sheet'

interface Props {
  exercise: Exercise
  /** Number of workouts using the exercise (it can't be deleted while used). */
  usage: number
  onClose: () => void
  onDeleted?: () => void
  /** Called with the exercise once it is saved. */
  onSaved?: (exercise: Exercise) => void
  level?: number
}

/** Sheet to create or edit an exercise. A blank `id` means "new". Every field but the notes is required. */
export function ExerciseSheet({ exercise, usage, onClose, onDeleted, onSaved, level = 2 }: Props) {
  const [draft, setDraft] = useState(exercise)
  const [tried, setTried] = useState(false)
  const isNew = !exercise.id
  const missing = tried ? missingFields(draft) : []
  const primary = draft.primary ?? []

  async function save() {
    const next: Exercise = { ...draft, name: draft.name.trim(), id: draft.id || newId() }
    const lacking = missingFields(next)
    if (lacking.length) {
      setTried(true)
      await notify('Faltan datos', `Completa: ${lacking.join(', ')}.`)
      return
    }
    const clash = (await db.exercises.toArray()).find((e) => e.id !== next.id && exerciseKey(e) === exerciseKey(next))
    if (clash) {
      await notify('Ese ejercicio ya existe', `«${exerciseLabel(clash)}» ya está en la lista.`)
      return
    }
    await db.exercises.put(next)
    onClose()
    onSaved?.(next)
  }

  async function remove() {
    if (usage > 0) {
      await notify('No se puede eliminar', `Aparece en ${usage} ${usage === 1 ? 'entreno' : 'entrenos'}.`)
      return
    }
    const title = `¿Eliminar «${exerciseLabel(exercise)}»?`
    if (!(await confirmDialog({ title, confirm: 'Eliminar', danger: true }))) return
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

  function togglePrimary(m: Muscle) {
    const next = primary.includes(m) ? primary.filter((x) => x !== m) : [...primary, m]
    setDraft({ ...draft, primary: next, secondary: draft.secondary?.filter((x) => x !== m) })
  }

  function toggleSecondary(m: Muscle) {
    const list = draft.secondary ?? []
    setDraft({ ...draft, secondary: list.includes(m) ? list.filter((x) => x !== m) : [...list, m] })
  }

  const invalid = (field: string) => (missing.includes(field) ? 'invalid' : undefined)

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
        <label className={invalid('nombre')}>
          Nombre
          <input
            value={draft.name}
            placeholder="Por ejemplo, Press de banca"
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label className={invalid('material')}>
          Material
          <select
            value={draft.equipment ?? ''}
            onChange={(e) => setDraft({ ...draft, equipment: e.target.value as Equipment })}
          >
            <option value="" disabled>
              Elige el material
            </option>
            {EQUIPMENT.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </select>
        </label>
        <div className={`field ${invalid('lateralidad') ?? ''}`}>
          <span className="field-label" id="laterality-label">
            Lateralidad
          </span>
          <div className="segmented" role="group" aria-labelledby="laterality-label">
            {LATERALITY.map((l) => (
              <button key={l} aria-pressed={draft.laterality === l} onClick={() => setDraft({ ...draft, laterality: l })}>
                {l === 'Unilateral' ? 'Unilateral (por lados)' : l}
              </button>
            ))}
          </div>
        </div>
        <div className={`field ${invalid('músculos principales') ?? ''}`}>
          <span className="field-label">Músculos principales</span>
          <p className="field-hint">Los que más trabaja. Son los que se ven en las listas y los filtros.</p>
          <MuscleChips label="Músculos principales" selected={primary} onToggle={togglePrimary} />
        </div>
        <div className={`field ${invalid('músculos secundarios') ?? ''}`}>
          <span className="field-label">Músculos secundarios</span>
          <p className="field-hint">Los que también trabajan. Solo se ven en la ficha del ejercicio.</p>
          <div className="chips">
            <button
              className="chip"
              aria-pressed={draft.secondary?.length === 0}
              onClick={() => setDraft({ ...draft, secondary: [] })}
            >
              Ninguno
            </button>
          </div>
          <MuscleChips
            label="Músculos secundarios"
            selected={draft.secondary ?? []}
            hidden={primary}
            onToggle={toggleSecondary}
          />
        </div>
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
          Notas (opcional)
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

/** Muscles as toggle chips, by body area. `hidden` muscles are left out (e.g. the primary ones). */
function MuscleChips({
  label,
  selected,
  hidden = [],
  onToggle,
}: {
  label: string
  selected: Muscle[]
  hidden?: Muscle[]
  onToggle: (m: Muscle) => void
}) {
  return (
    <div className="muscle-chips" role="group" aria-label={label}>
      {MUSCLE_GROUP_NAMES.map((g) => {
        const muscles = (MUSCLE_GROUPS[g] as readonly Muscle[]).filter((m) => !hidden.includes(m))
        if (!muscles.length) return null
        return (
          <div key={g} className="muscle-row">
            <span className="muscle-row-name">{g}</span>
            <div className="chips">
              {muscles.map((m) => (
                <button key={m} className="chip" aria-pressed={selected.includes(m)} onClick={() => onToggle(m)}>
                  {m}
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
