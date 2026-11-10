import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { exerciseContext } from './workouts'

/** All exercises by id. */
export function useExerciseMap() {
  return useLiveQuery(async () => new Map((await db.exercises.toArray()).map((e) => [e.id, e] as const)), [])
}

/** For each exercise: the previous session ("Anterior") and earlier bests (to flag records). */
export function useExerciseContexts(workoutId: string, exerciseIds: string[], before: number) {
  const key = [...new Set(exerciseIds)].join(',')
  return useLiveQuery(async () => {
    const ids = key ? key.split(',') : []
    const entries = await Promise.all(ids.map(async (eid) => [eid, await exerciseContext(eid, workoutId, before)] as const))
    return new Map(entries)
  }, [key, workoutId, before])
}
