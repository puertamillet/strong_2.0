import { db, type Exercise, type Template, type Workout } from '../db'
import { strongName } from './exercises'
import { expandTemplateSides, expandWorkoutSides } from './legacy'
import { migrateToCatalog } from './migrations'
import { parseStrongCsv, workoutsToStrongCsv } from './strong'

export interface ImportSummary {
  added: number
  skipped: number
  newExercises: number
}

/**
 * Import a Strong CSV export. Workouts already imported are skipped, so it can be re-run safely.
 * Templates are not made from the history: they come from a templates CSV (lib/templatesCsv).
 */
export async function importStrongCsv(text: string): Promise<ImportSummary> {
  const existing = await db.exercises.toArray()
  const parsed = parseStrongCsv(text, existing)
  return db.transaction('rw', db.exercises, db.workouts, async () => {
    const present = await db.workouts.bulkGet(parsed.workouts.map((w) => w.id))
    const fresh = parsed.workouts.filter((_, i) => !present[i])
    const usedIds = new Set(fresh.flatMap((w) => w.exerciseIds))
    const newExercises = parsed.newExercises.filter((e) => usedIds.has(e.id))
    await db.exercises.bulkAdd(newExercises)
    await db.workouts.bulkAdd(fresh)
    return {
      added: fresh.length,
      skipped: parsed.workouts.length - fresh.length,
      newExercises: newExercises.length,
    }
  })
}

export async function exportStrongCsv(): Promise<string> {
  const [workouts, exercises] = await Promise.all([db.workouts.toArray(), db.exercises.toArray()])
  return workoutsToStrongCsv(workouts, new Map(exercises.map((e) => [e.id, strongName(e)])))
}

export interface Backup {
  app: 'strong2'
  /** 1: before the exercise catalog (exercises named as in Strong). 2: exercises from the catalog. */
  version: 1 | 2
  exportedAt: number
  exercises: Exercise[]
  workouts: Workout[]
  templates: Template[]
}

export async function createBackup(): Promise<Backup> {
  const [exercises, workouts, templates] = await Promise.all([
    db.exercises.toArray(),
    db.workouts.toArray(),
    db.templates.toArray(),
  ])
  return { app: 'strong2', version: 2, exportedAt: Date.now(), exercises, workouts, templates }
}

function isBackup(x: unknown): x is Backup {
  const b = x as Backup
  return (
    !!b &&
    b.app === 'strong2' &&
    Array.isArray(b.exercises) &&
    Array.isArray(b.workouts) &&
    Array.isArray(b.templates)
  )
}

/** Replace all data with the contents of a backup. */
export async function restoreBackup(text: string): Promise<{ workouts: number }> {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('El archivo no es una copia de seguridad válida.')
  }
  if (!isBackup(data)) throw new Error('El archivo no es una copia de seguridad de esta app.')
  // Older copies get the same changes the database got when the app updated: one set per side for
  // unilateral exercises (database version 2) and, before the catalog, its exercises (version 3).
  const sides = { ...data, workouts: data.workouts.map(expandWorkoutSides), templates: data.templates.map(expandTemplateSides) }
  const backup = (data.version ?? 1) < 2 ? migrateToCatalog(sides) : sides
  await db.transaction('rw', db.exercises, db.workouts, db.templates, async () => {
    await Promise.all([db.exercises.clear(), db.workouts.clear(), db.templates.clear()])
    await db.exercises.bulkAdd(backup.exercises)
    await db.workouts.bulkAdd(backup.workouts)
    await db.templates.bulkAdd(backup.templates)
  })
  return { workouts: backup.workouts.length }
}

export async function deleteAllData(): Promise<void> {
  await db.transaction('rw', db.exercises, db.workouts, db.templates, async () => {
    await Promise.all([db.exercises.clear(), db.workouts.clear(), db.templates.clear()])
  })
}

const LAST_BACKUP_KEY = 'strong2.lastBackup'

export function getLastBackup(): number | null {
  try {
    const v = localStorage.getItem(LAST_BACKUP_KEY)
    return v ? Number(v) : null
  } catch {
    return null
  }
}

export function markBackupDone(): void {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, String(Date.now()))
  } catch {
    // ignore
  }
}

/**
 * Hand a file to the user. On iPhone this opens the share sheet ("Guardar en Archivos",
 * AirDrop, etc.); elsewhere it falls back to a regular download.
 * Returns false if the user cancelled the share sheet.
 */
export async function saveFile(name: string, content: string, type: string): Promise<boolean> {
  const file = new File([content], name, { type })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return true
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return false
      // Fall through to download.
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return true
}

export function fileStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
