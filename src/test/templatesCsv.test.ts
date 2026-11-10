import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Exercise, Template } from '../db'
import { parseTemplatesCsv, planTemplateImport, templatesToCsv } from '../lib/templatesCsv'

// A spreadsheet export in Spanish: ";" between columns, decimal commas, a note on two lines.
const SAMPLE = [
  'Plantilla;Exercise Name;Ejercicio;Nota fija;Nota;Serie;kg;Reps;Rango;Descanso;Lados;Descanso entre lados;kg 2º lado;Reps 2º lado',
  'Empuje;Bench Press (Barbell);Press de banca;"52 de altura\nBarra recta";Hacerlo despacio;Calentamiento;20;6;;1:00;;;;',
  'Empuje;Bench Press (Barbell);Press de banca;;;Top set;95;5;4-6;3:30;;;;',
  'Empuje;Bench Press (Barbell);Press de banca;;;Back off;85;7;6-8;180;;;;',
  'Empuje;Unilateral Triceps Extension (Cable);Extensión de tríceps;;;Normal;16,25;10;9-12;1:30;2;0:00;;',
  'Empuje;Unilateral Triceps Extension (Cable);Extensión de tríceps;;;Normal;15;11;9-12;1:30;2;1:30;15;9',
  'Pierna;;Sentadilla hack;;;;100;8;8;2:00;;;;',
].join('\n')

describe('templates CSV', () => {
  it('reads templates, sets, rests, sides and notes', () => {
    const [empuje, pierna] = parseTemplatesCsv(SAMPLE)
    expect(empuje.name).toBe('Empuje')
    expect(empuje.exercises.map((e) => e.exerciseName)).toEqual(['Bench Press (Barbell)', 'Unilateral Triceps Extension (Cable)'])
    const bench = empuje.exercises[0].exercise
    expect(bench.stickyNote).toBe('52 de altura\nBarra recta')
    expect(bench.notes).toBe('Hacerlo despacio')
    expect(bench.sets).toEqual([
      { type: 'warmup', weight: 20, reps: 6, rest: 60 },
      { type: 'top', weight: 95, reps: 5, rest: 210, range: [4, 6] },
      { type: 'backoff', weight: 85, reps: 7, rest: 180, range: [6, 8] },
    ])
    expect(empuje.exercises[1].exercise.sets).toEqual([
      { type: 'normal', weight: 16.25, reps: 10, rest: 90, range: [9, 12], sides: 2, sideRest: 0 },
      { type: 'normal', weight: 15, reps: 11, rest: 90, range: [9, 12], sides: 2, sideRest: 90, second: { weight: 15, reps: 9 } },
    ])
    expect(empuje.exercises[1].exercise.restSeconds).toBe(90)
    // Only the Spanish name: still an exercise, of type Normal by default.
    expect(pierna.exercises[0]).toMatchObject({ exerciseName: 'Sentadilla hack', name: 'Sentadilla hack' })
    expect(pierna.exercises[0].exercise.sets[0]).toEqual({ type: 'normal', weight: 100, reps: 8, rest: 120, range: [8, 8] })
  })

  it('says which row is wrong', () => {
    const head = SAMPLE.split('\n')[0]
    const bad = (row: string) => () => parseTemplatesCsv(`${head}\n${row}`)
    expect(bad('Empuje;Bench Press (Barbell);;;;Superserie;20;6;;;;;;')).toThrow(/Fila 2: tipo de serie desconocido «Superserie»/)
    expect(bad('Empuje;Bench Press (Barbell);;;;;20;6;seis;;;;;')).toThrow(/Fila 2: rango no válido/)
    expect(bad('Empuje;Bench Press (Barbell);;;;;20;6;;1h;;;;')).toThrow(/Fila 2: descanso no válido/)
    expect(bad('Empuje;Bench Press (Barbell);;;;;20;6;;;3;;;')).toThrow(/Fila 2: lados debe ser 1 o 2/)
    expect(() => parseTemplatesCsv('Date,Workout Name\n1,2')).toThrow(/CSV de plantillas/)
  })

  it('replaces templates with the same name and creates missing exercises', () => {
    const exercises: Exercise[] = [{ id: 'bench', name: 'Bench Press (Barbell)', createdAt: 0 }]
    const existing: Template[] = [{ id: 'old', name: 'empuje', updatedAt: 0, exercises: [] }]
    const plan = planTemplateImport(parseTemplatesCsv(SAMPLE), existing, exercises)
    expect(plan.replaced).toEqual(['empuje'])
    expect(plan.templates.map((t) => [t.id === 'old', t.name])).toEqual([
      [true, 'Empuje'],
      [false, 'Pierna'],
    ])
    expect(plan.newExercises.map((e) => [e.name, e.laterality])).toEqual([
      ['Unilateral Triceps Extension (Cable)', 'Unilateral'],
      ['Sentadilla hack', 'Bilateral'],
    ])
    expect(plan.templates[0].exercises[0].exerciseId).toBe('bench')
  })

  it('finds an exercise still named as in Strong by its name in Spanish, if only one matches', () => {
    const exercises: Exercise[] = [{ id: 'hack', name: 'Squat (Machine)', createdAt: 0 }]
    const plan = planTemplateImport(parseTemplatesCsv(SAMPLE), [], exercises)
    expect(plan.templates[1].exercises[0].exerciseId).toBe('hack')
  })

  it('exports what it imports', () => {
    const exercises: Exercise[] = [
      { id: 'bench', name: 'Bench Press (Barbell)', createdAt: 0 },
      { id: 'ext', name: 'Unilateral Triceps Extension (Cable)', createdAt: 0 },
      { id: 'hack', name: 'Squat (Machine)', createdAt: 0 },
    ]
    const { templates } = planTemplateImport(parseTemplatesCsv(SAMPLE), [], exercises)
    const again = planTemplateImport(
      parseTemplatesCsv(templatesToCsv(templates, new Map(exercises.map((e) => [e.id, e])))),
      [],
      exercises,
    )
    expect(again.templates.map((t) => [t.name, t.exercises])).toEqual(templates.map((t) => [t.name, t.exercises]))
    expect(again.newExercises).toEqual([])
  })
})

// Optional: TEMPLATES_CSV=/path/plantillas.csv npm test checks a real file.
const realCsv = process.env.TEMPLATES_CSV
describe.runIf(realCsv)('real templates CSV', () => {
  it('reads every set', () => {
    const templates = parseTemplatesCsv(readFileSync(realCsv!, 'utf8'))
    const sets = templates.reduce((n, t) => n + t.exercises.reduce((m, e) => m + e.exercise.sets.length, 0), 0)
    console.log(`${templates.length} plantillas: ${templates.map((t) => `${t.name} (${t.exercises.length})`).join(', ')}; ${sets} series`)
    expect(templates.length).toBeGreaterThan(0)
  })
})
