import type { Template, Workout } from '../db'
import { choose, type DialogOption } from './dialog'
import { structureChanged, syncTemplate, templateChanges, valuesChanged, type TemplateChanges } from './workouts'

/** What the template takes: today's values (and sticky notes), or also its exercises, sets, rests and target reps. */
export type TemplateUpdate = 'values' | 'all'

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function sentences(parts: string[]): string {
  return parts.map((p) => `${p}.`).join(' ')
}

/** "Quita 3 ejercicios. Añade 1 serie. Actualiza los descansos.", as Strong words it. */
export function describeStructure(c: TemplateChanges): string {
  const parts: string[] = []
  if (c.removedExercises) parts.push(`Quita ${count(c.removedExercises, 'ejercicio', 'ejercicios')}`)
  if (c.addedExercises) parts.push(`Añade ${count(c.addedExercises, 'ejercicio', 'ejercicios')}`)
  if (c.removedSets) parts.push(`Quita ${count(c.removedSets, 'serie', 'series')}`)
  if (c.addedSets) parts.push(`Añade ${count(c.addedSets, 'serie', 'series')}`)
  if (c.setTypes) parts.push(`Cambia el tipo de ${count(c.setTypes, 'serie', 'series')}`)
  if (c.order) parts.push('Cambia el orden de los ejercicios')
  if (c.rests) parts.push('Actualiza los descansos')
  if (c.ranges) parts.push('Actualiza los rangos de repeticiones')
  return sentences(parts)
}

/** "Actualiza los valores de 2 series." */
export function describeValues(c: TemplateChanges): string {
  const parts: string[] = []
  if (c.values) parts.push(`Actualiza los valores de ${count(c.values, 'serie', 'series')}`)
  if (c.notes) parts.push(c.notes === 1 ? 'Actualiza 1 nota fija' : `Actualiza ${c.notes} notas fijas`)
  return sentences(parts)
}

/**
 * The choices after finishing a workout started from a template, like Strong's: update only the
 * values, the template and values, or keep the original. Updating in a way that removes exercises
 * or sets is shown in red. No choices if nothing changed.
 */
export function templateUpdateOptions(c: TemplateChanges): DialogOption<TemplateUpdate | null>[] {
  const values = valuesChanged(c)
  const structure = structureChanged(c)
  if (!values && !structure) return []
  const removes = c.removedExercises > 0 || c.removedSets > 0
  const options: DialogOption<TemplateUpdate | null>[] = []
  if (values) {
    options.push({
      label: structure ? 'Actualizar solo valores' : 'Actualizar valores',
      detail: describeValues(c),
      value: 'values',
      style: 'primary',
    })
  }
  if (structure) {
    options.push({
      label: values ? 'Actualizar plantilla y valores' : 'Actualizar plantilla',
      detail: describeStructure(c),
      value: 'all',
      style: removes ? 'danger-tinted' : values ? 'tinted' : 'primary',
    })
  }
  options.push({ label: 'Mantener plantilla original', value: null, style: 'plain' })
  return options
}

/**
 * Asks how to update the template the workout came from, if anything changed, and updates it.
 * `w` is the workout as it was before finishing (with unticked sets). Closing the dialog keeps
 * the template as it was.
 */
export async function offerTemplateUpdate(w: Workout, t: Template): Promise<void> {
  const options = templateUpdateOptions(templateChanges(w, t))
  if (!options.length) return
  const answer = await choose(
    'Actualizar plantilla',
    options,
    `Has hecho cambios respecto a la plantilla «${t.name}». ¿Quieres actualizarla?`,
  )
  if (answer) await syncTemplate(w, t.id, answer)
}
