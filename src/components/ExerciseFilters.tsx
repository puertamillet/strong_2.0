import { EQUIPMENT, MUSCLE_GROUP_NAMES, MUSCLE_GROUPS, type Equipment } from '../lib/catalog'
import { choose } from '../lib/dialog'
import type { ExerciseFilter } from '../lib/exercises'
import { Icon } from './icons'

interface Props {
  filter: ExerciseFilter
  onChange: (filter: ExerciseFilter) => void
}

/**
 * Chips to filter exercises by body area, then by muscle, and by equipment.
 * Only primary muscles count: an exercise is under "Pierna" if it mainly works the legs.
 */
export function ExerciseFilters({ filter, onChange }: Props) {
  const muscles = filter.group ? MUSCLE_GROUPS[filter.group] : []

  async function pickEquipment() {
    const picked = await choose<Equipment | 'any' | null>('Material', [
      { label: 'Cualquier material', value: 'any', style: filter.equipment ? 'plain' : 'primary' },
      ...EQUIPMENT.map((e) => ({ label: e, value: e, style: filter.equipment === e ? ('primary' as const) : ('plain' as const) })),
      { label: 'Cancelar', value: null },
    ])
    if (picked !== null) onChange({ ...filter, equipment: picked === 'any' ? null : picked })
  }

  return (
    <div className="filters">
      <div className="filter-chips" role="group" aria-label="Filtrar por músculo principal">
        <button
          className={`chip ${filter.equipment ? 'on' : ''}`}
          aria-label={filter.equipment ? `Material: ${filter.equipment}` : 'Filtrar por material'}
          onClick={() => void pickEquipment()}
        >
          {filter.equipment ?? 'Material'}
          <Icon name="chevronDown" size={14} />
        </button>
        {MUSCLE_GROUP_NAMES.map((g) => (
          <button
            key={g}
            className="chip"
            aria-pressed={filter.group === g}
            onClick={() => onChange({ ...filter, group: filter.group === g ? null : g, muscle: null })}
          >
            {g}
          </button>
        ))}
      </div>
      {muscles.length > 1 && (
        <div className="filter-chips sub" role="group" aria-label={`Músculos de ${filter.group}`}>
          {muscles.map((m) => (
            <button
              key={m}
              className="chip"
              aria-pressed={filter.muscle === m}
              onClick={() => onChange({ ...filter, muscle: filter.muscle === m ? null : m })}
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
