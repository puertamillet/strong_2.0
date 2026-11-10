import type { Exercise } from '../db'

/**
 * The exercise's classification in small boxes next to its name: the equipment and, when it is done
 * one side at a time, «Unilateral». With `full` (the exercise's page) bilateral ones say so too.
 */
export function ExerciseTags({ exercise, full = false }: { exercise: Pick<Exercise, 'equipment' | 'laterality'>; full?: boolean }) {
  const tags: string[] = []
  if (exercise.equipment) tags.push(exercise.equipment)
  if (exercise.laterality && (full || exercise.laterality === 'Unilateral')) tags.push(exercise.laterality)
  if (!tags.length) return null
  return (
    <span className="tags">
      {tags.map((t) => (
        <span key={t} className="tag">
          {t}
        </span>
      ))}
    </span>
  )
}
