import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Exercise, Template } from '../db'
import { parseTemplatesCsv, planTemplateImport, TEMPLATE_HEADER, templatesToCsv } from '../lib/templatesCsv'

// A spreadsheet export in Spanish: ";" between columns, decimal commas, a note on two lines.
// The unilateral exercise has a row per side, resting 0:00 between the sides. It is from when
// there were two notes, «Nota fija» and «Nota»: they make one.
const SAMPLE = [
  'Plantilla;Exercise Name;Ejercicio;Nota fija;Nota;Serie;kg;Reps;Rango;Descanso',
  'Empuje;Bench Press (Barbell);Press de banca;"52 de altura\nBarra recta";Hacerlo despacio;Calentamiento;20;6;;1:00',
  'Empuje;Bench Press (Barbell);Press de banca;;;Top set;95;5;4-6;3:30',
  'Empuje;Bench Press (Barbell);Press de banca;;;Back off;85;7;6-8;180',
  'Empuje;Unilateral Triceps Extension (Cable);Extensión de tríceps;;;Normal;16,25;10;9-12;0:00',
  'Empuje;Unilateral Triceps Extension (Cable);Extensión de tríceps;;;Normal;16,25;10;9-12;1:30',
  'Pierna;;Sentadilla hack;;;;100;8;8;2:00',
].join('\n')

// A file from when the two sides of a set were one row.
const TWO_SIDED = [
  'Plantilla;Exercise Name;Ejercicio;Nota fija;Nota;Serie;kg;Reps;Rango;Descanso;Lados;Descanso entre lados;kg 2º lado;Reps 2º lado',
  'Brazo;Curl de prueba;;;;Normal;16,25;10;9-12;1:30;2;0:00;;',
  'Brazo;Curl de prueba;;;;Normal;15;11;;1:30;2;;15;9',
  'Brazo;Curl de prueba;;;;Normal;15;11;;;1;;;',
].join('\n')

// Press de banca with a barbell, as the catalog has it.
const bench: Exercise = {
  id: 'bench',
  name: 'Press de banca',
  equipment: 'Barra',
  laterality: 'Bilateral',
  primary: ['Pectoral'],
  secondary: ['Deltoides anterior', 'Tríceps'],
  strongNames: ['Bench Press (Barbell)'],
  createdAt: 0,
}

describe('templates CSV', () => {
  it('reads templates, sets, rests and notes', () => {
    const [empuje, pierna] = parseTemplatesCsv(SAMPLE)
    expect(empuje.name).toBe('Empuje')
    expect(empuje.exercises.map((e) => e.exerciseName)).toEqual(['Bench Press (Barbell)', 'Unilateral Triceps Extension (Cable)'])
    const bench = empuje.exercises[0].exercise
    expect(bench.stickyNote).toBe('52 de altura\nBarra recta\nHacerlo despacio')
    expect(bench).not.toHaveProperty('notes')
    expect(bench.sets).toEqual([
      { type: 'warmup', weight: 20, reps: 6, rest: 60 },
      { type: 'top', weight: 95, reps: 5, rest: 210, range: [4, 6] },
      { type: 'backoff', weight: 85, reps: 7, rest: 180, range: [6, 8] },
    ])
    expect(empuje.exercises[1].exercise.sets).toEqual([
      { type: 'normal', weight: 16.25, reps: 10, rest: 0, range: [9, 12] },
      { type: 'normal', weight: 16.25, reps: 10, rest: 90, range: [9, 12] },
    ])
    // As often 0:00 as 1:30: the exercise's rest is the longer one.
    expect(empuje.exercises[1].exercise.restSeconds).toBe(90)
    // Only the Spanish name: still an exercise, of type Normal by default.
    expect(pierna.exercises[0]).toMatchObject({ exerciseName: 'Sentadilla hack', name: 'Sentadilla hack' })
    expect(pierna.exercises[0].exercise.sets[0]).toEqual({ type: 'normal', weight: 100, reps: 8, rest: 120, range: [8, 8] })
  })

  it('reads a row with two sides as one set per side', () => {
    const [brazo] = parseTemplatesCsv(TWO_SIDED)
    expect(brazo.exercises[0].unilateral).toBe(true)
    expect(brazo.exercises[0].exercise.sets).toEqual([
      // The first side rests what was the rest between sides; without one, the rest of the set.
      { type: 'normal', weight: 16.25, reps: 10, rest: 0, range: [9, 12] },
      { type: 'normal', weight: 16.25, reps: 10, rest: 90, range: [9, 12] },
      { type: 'normal', weight: 15, reps: 11, rest: 90 },
      { type: 'normal', weight: 15, reps: 9, rest: 90 },
      { type: 'normal', weight: 15, reps: 11 },
    ])
    // A new exercise from such a file is unilateral.
    const plan = planTemplateImport([brazo], [], [])
    expect(plan.newExercises.map((e) => [e.name, e.laterality])).toEqual([['Curl de prueba', 'Unilateral']])
  })

  it('says which row is wrong', () => {
    const bad = (row: string, head = SAMPLE.split('\n')[0]) => () => parseTemplatesCsv(`${head}\n${row}`)
    expect(bad('Empuje;Bench Press (Barbell);;;;Superserie;20;6;;')).toThrow(/Fila 2: tipo de serie desconocido «Superserie»/)
    expect(bad('Empuje;Bench Press (Barbell);;;;;20;6;seis;')).toThrow(/Fila 2: rango no válido/)
    expect(bad('Empuje;Bench Press (Barbell);;;;;20;6;;1h')).toThrow(/Fila 2: descanso no válido/)
    expect(bad('Brazo;Curl de prueba;;;;;20;6;;;3;;;', TWO_SIDED.split('\n')[0])).toThrow(/Fila 2: lados debe ser 1 o 2/)
    expect(() => parseTemplatesCsv('Date,Workout Name\n1,2')).toThrow(/CSV de plantillas/)
  })

  it('replaces templates with the same name and creates missing exercises from the catalog', () => {
    const exercises: Exercise[] = [bench]
    const existing: Template[] = [{ id: 'old', name: 'empuje', updatedAt: 0, exercises: [] }]
    const plan = planTemplateImport(parseTemplatesCsv(SAMPLE), existing, exercises)
    expect(plan.replaced).toEqual(['empuje'])
    expect(plan.templates.map((t) => [t.id === 'old', t.name])).toEqual([
      [true, 'Empuje'],
      [false, 'Pierna'],
    ])
    // Found by its name in Strong.
    expect(plan.templates[0].exercises[0].exerciseId).toBe('bench')
    // By its name in Strong, or by the Spanish one when only one catalog exercise has it.
    expect(plan.newExercises.map((e) => [e.name, e.equipment, e.laterality])).toEqual([
      ['Extensión de tríceps', 'Cables', 'Unilateral'],
      ['Sentadilla hack', 'Máquina de discos', 'Bilateral'],
    ])
    expect(plan.newExercises[0].strongNames).toContain('Unilateral Triceps Extension (Cable)')
  })

  it('finds exercises by their name in Spanish only when one has it', () => {
    const hack: Exercise = { id: 'hack', name: 'Sentadilla hack', equipment: 'Máquina de discos', laterality: 'Bilateral', createdAt: 0 }
    const plan = planTemplateImport(parseTemplatesCsv(SAMPLE), [], [bench, hack])
    expect(plan.templates[1].exercises[0].exerciseId).toBe('hack')

    // Two exercises are called «Press de banca»: a new one, to complete by hand.
    const dumbbells: Exercise = { ...bench, id: 'bench-db', equipment: 'Mancuernas', strongNames: ['Bench Press (Dumbbell)'] }
    const ambiguous = 'Plantilla;Ejercicio;kg;Reps\nPecho;Press de banca;60;8'
    const again = planTemplateImport(parseTemplatesCsv(ambiguous), [], [bench, dumbbells])
    expect(again.newExercises.map((e) => [e.name, e.equipment, e.laterality])).toEqual([['Press de banca', undefined, 'Bilateral']])
  })

  it('makes one exercise of the rows that name the same new one', () => {
    const csv = 'Plantilla;Exercise Name;Ejercicio;kg;Reps\nA;Squat (Machine);;100;8\nB;;Sentadilla hack;100;8'
    const plan = planTemplateImport(parseTemplatesCsv(csv), [], [])
    expect(plan.newExercises).toHaveLength(1)
    expect(plan.templates[1].exercises[0].exerciseId).toBe(plan.newExercises[0].id)
  })

  it('reads the note column of the files it writes, on any row of the exercise', () => {
    expect(TEMPLATE_HEADER).toContain('Nota')
    expect(TEMPLATE_HEADER).not.toContain('Nota fija')
    const csv = [
      'Plantilla;Ejercicio;Nota;Serie;kg;Reps',
      'Brazo;Curl de prueba;;Normal;15;10',
      'Brazo;Curl de prueba;Banco en el 3;Normal;15;10',
      'Brazo;Curl de prueba;Banco en el 3;Normal;15;10',
    ].join('\n')
    expect(parseTemplatesCsv(csv)[0].exercises[0].exercise.stickyNote).toBe('Banco en el 3')
  })

  it('exports what it imports', () => {
    const exercises: Exercise[] = [
      bench,
      { id: 'ext', name: 'Extensión de tríceps', equipment: 'Cables', laterality: 'Unilateral', strongNames: ['Unilateral Triceps Extension (Cable)'], createdAt: 0 },
      { id: 'hack', name: 'Sentadilla hack', equipment: 'Máquina de discos', laterality: 'Bilateral', strongNames: ['Squat (Machine)'], createdAt: 0 },
    ]
    const { templates } = planTemplateImport(parseTemplatesCsv(SAMPLE), [], exercises)
    expect(templates.flatMap((t) => t.exercises.map((e) => e.exerciseId))).toEqual(['bench', 'ext', 'hack'])
    const csv = templatesToCsv(templates, new Map(exercises.map((e) => [e.id, e])))
    expect(csv.split(/\r?\n/)[0]).toBe(TEMPLATE_HEADER.join(','))
    const again = planTemplateImport(parseTemplatesCsv(csv), [], exercises)
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
