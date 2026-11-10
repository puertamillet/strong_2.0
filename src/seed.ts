import { db, newId, type Exercise } from './db'

/** Starter catalog. Names follow Strong's "Name (Equipment)" convention so imports merge with them. */
export const SEED_EXERCISES: Record<string, string[]> = {
  Pecho: [
    'Bench Press (Barbell)',
    'Bench Press (Dumbbell)',
    'Incline Bench Press (Barbell)',
    'Incline Bench Press (Dumbbell)',
    'Chest Press (Machine)',
    'Incline Chest Press (Machine)',
    'Chest Fly',
    'Chest Fly (Cable)',
    'Cable Crossover',
    'Push Up',
  ],
  Espalda: [
    'Deadlift (Barbell)',
    'Pull Up',
    'Chin Up',
    'Lat Pulldown (Cable)',
    'Lat Pulldown (Machine)',
    'Seated Row (Cable)',
    'Seated Row (Machine)',
    'Bent Over Row (Barbell)',
    'Bent Over One Arm Row (Dumbbell)',
    'T Bar Row',
    'Face Pull (Cable)',
  ],
  Hombro: [
    'Overhead Press (Barbell)',
    'Shoulder Press (Dumbbell)',
    'Shoulder Press (Machine)',
    'Arnold Press (Dumbbell)',
    'Lateral Raise (Dumbbell)',
    'Lateral Raise (Cable)',
    'Reverse Fly (Machine)',
  ],
  Brazo: [
    'Bicep Curl (Barbell)',
    'Bicep Curl (Dumbbell)',
    'Bicep Curl (Cable)',
    'Hammer Curl (Dumbbell)',
    'Preacher Curl (Machine)',
    'Triceps Extension (Cable)',
    'Triceps Extension Overhead (Cable)',
    'Skullcrusher (Barbell)',
    'Triceps Dip',
  ],
  Pierna: [
    'Squat (Barbell)',
    'Front Squat (Barbell)',
    'Leg Press',
    'Leg Extension (Machine)',
    'Lying Leg Curl (Machine)',
    'Seated Leg Curl (Machine)',
    'Romanian Deadlift (Barbell)',
    'Hip Thrust (Barbell)',
    'Bulgarian Split Squat (Dumbbell)',
    'Hip Abductor (Machine)',
    'Hip Adductor (Machine)',
    'Standing Calf Raise (Machine)',
    'Seated Calf Raise (Machine)',
  ],
  Abdomen: ['Crunch (Machine)', 'Cable Crunch', 'Hanging Leg Raise', 'Plank'],
}

/** Best-effort category for an exercise name that is not in the seed list. */
export function guessCategory(name: string): string | undefined {
  for (const [category, names] of Object.entries(SEED_EXERCISES)) {
    if (names.some((n) => n.toLowerCase() === name.toLowerCase())) return category
  }
  const n = name.toLowerCase()
  const rules: [string, RegExp][] = [
    // Order matters: e.g. "Reverse Fly" is shoulders, not chest; "Leg Curl" is legs, not arms.
    ['Abdomen', /crunch|plank|leg raise|sit up/],
    ['Brazo', /tricep|bicep|skull|dip|(?<!leg )curl/],
    ['Hombro', /shoulder|lateral raise|overhead press|arnold|reverse fly|face pull|shrug/],
    ['Pierna', /squat|leg |calf|hip|glute|lunge|deadlift|adductor|abductor/],
    ['Pecho', /bench|chest|fly|crossover|push up|pec/],
    ['Espalda', /row|pull|pulldown|pullover|chin/],
  ]
  return rules.find(([, re]) => re.test(n))?.[0]
}

export async function seedIfEmpty(): Promise<void> {
  await db.transaction('rw', db.exercises, async () => {
    if ((await db.exercises.count()) > 0) return
    const now = Date.now()
    const rows: Exercise[] = Object.entries(SEED_EXERCISES).flatMap(([category, names]) =>
      names.map((name) => ({ id: newId(), name, category, createdAt: now })),
    )
    await db.exercises.bulkAdd(rows)
  })
}
