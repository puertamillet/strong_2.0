import { describe, expect, it } from 'vitest'
import { describeStructure, describeValues, templateUpdateOptions } from '../lib/templateUpdate'
import type { TemplateChanges } from '../lib/workouts'

const none: TemplateChanges = {
  values: 0,
  notes: 0,
  addedExercises: 0,
  removedExercises: 0,
  addedSets: 0,
  removedSets: 0,
  setTypes: 0,
  rests: false,
  ranges: false,
  order: false,
}
const changes = (c: Partial<TemplateChanges>): TemplateChanges => ({ ...none, ...c })

describe('updating the template after a workout', () => {
  it('says what would change, as Strong does', () => {
    expect(describeStructure(changes({ removedExercises: 3, addedSets: 1, rests: true }))).toBe(
      'Quita 3 ejercicios. Añade 1 serie. Actualiza los descansos.',
    )
    expect(describeStructure(changes({ addedExercises: 1, removedSets: 2, setTypes: 1, order: true }))).toBe(
      'Añade 1 ejercicio. Quita 2 series. Cambia el tipo de 1 serie. Cambia el orden de los ejercicios.',
    )
    expect(describeStructure(changes({ rests: true, ranges: true }))).toBe(
      'Actualiza los descansos. Actualiza los rangos de repeticiones.',
    )
    expect(describeValues(changes({ values: 1 }))).toBe('Actualiza los valores de 1 serie.')
    expect(describeValues(changes({ values: 4, notes: 1 }))).toBe('Actualiza los valores de 4 series. Actualiza 1 nota.')
    expect(describeValues(changes({ notes: 2 }))).toBe('Actualiza 2 notas.')
  })

  it('asks nothing if nothing changed', () => {
    expect(templateUpdateOptions(none)).toEqual([])
  })

  it('offers only the values, the template and values, or keeping it', () => {
    const options = templateUpdateOptions(changes({ values: 1, rests: true }))
    expect(options.map((o) => [o.label, o.detail, o.value, o.style])).toEqual([
      ['Actualizar solo valores', 'Actualiza los valores de 1 serie.', 'values', 'primary'],
      ['Actualizar plantilla y valores', 'Actualiza los descansos.', 'all', 'tinted'],
      ['Mantener plantilla original', undefined, null, 'plain'],
    ])
  })

  it('shows in red an update that removes exercises or sets', () => {
    const options = templateUpdateOptions(changes({ removedExercises: 3, addedSets: 1, rests: true }))
    expect(options.map((o) => [o.label, o.value, o.style])).toEqual([
      ['Actualizar plantilla', 'all', 'danger-tinted'],
      ['Mantener plantilla original', null, 'plain'],
    ])
    expect(templateUpdateOptions(changes({ values: 2, removedSets: 1 }))[1].style).toBe('danger-tinted')
  })

  it('offers just the values when only they changed', () => {
    expect(templateUpdateOptions(changes({ values: 2 })).map((o) => o.label)).toEqual([
      'Actualizar valores',
      'Mantener plantilla original',
    ])
  })

  it('offers updating the template when only a target range changed', () => {
    expect(templateUpdateOptions(changes({ ranges: true })).map((o) => [o.label, o.detail, o.style])).toEqual([
      ['Actualizar plantilla', 'Actualiza los rangos de repeticiones.', 'primary'],
      ['Mantener plantilla original', undefined, 'plain'],
    ])
  })
})
