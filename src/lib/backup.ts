import { db, type Exercise, type Template, type Workout } from '../db'
import { parseStrongCsv, templatesFromHistory, workoutsToStrongCsv } from './strong'

export interface ImportSummary {
  added: number
  skipped: number
  newExercises: number
  templates: string[]
}

/** Import a Strong CSV export. Workouts already imported are skipped, so it can be re-run safely. */
export async function importStrongCsv(text: string, opts: { createTemplates: boolean }): Promise<ImportSummary> {
  const existing = await db.exercises.toArray()
  const parsed = parseStrongCsv(text, existing)
  return db.transaction('rw', db.exercises, db.workouts, db.templates, async () => {
    const present = await db.workouts.bulkGet(parsed.workouts.map((w) => w.id))
    const fresh = parsed.workouts.filter((_, i) => !present[i])
    const usedIds = new Set(fresh.flatMap((w) => w.exerciseIds))
    const newExercises = parsed.newExercises.filter((e) => usedIds.has(e.id))
    await db.exercises.bulkAdd(newExercises)
    await db.workouts.bulkAdd(fresh)

    let templates: Template[] = []
    if (opts.createTemplates) {
      const names = (await db.templates.toArray()).map((t) => t.name)
      templates = templatesFromHistory(parsed.workouts, names)
      // Templates may reference exercises of workouts skipped above; make sure they exist.
      const known = new Set((await db.exercises.toArray()).map((e) => e.id))
      const missing = parsed.newExercises.filter(
        (e) => !known.has(e.id) && templates.some((t) => t.exercises.some((x) => x.exerciseId === e.id)),
      )
      await db.exercises.bulkAdd(missing)
      await db.templates.bulkAdd(templates)
    }
    return {
      added: fresh.length,
      skipped: parsed.workouts.length - fresh.length,
      newExercises: newExercises.length,
      templates: templates.map((t) => t.name),
    }
  })
}

export async function exportStrongCsv(): Promise<string> {
  const [workouts, exercises] = await Promise.all([db.workouts.toArray(), db.exercises.toArray()])
  return workoutsToStrongCsv(workouts, new Map(exercises.map((e) => [e.id, e.name])))
}

export interface Backup {
  app: 'strong2'
  version: 1
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
  return { app: 'strong2', version: 1, exportedAt: Date.now(), exercises, workouts, templates }
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
  const backup = data
  await db.transaction('rw', db.exercises, db.workouts, db.templates, async () => {
    await Promise.all([db.exercises.clear(), db.workouts.clear(), db.templates.clear()])
    // Exercise names are unique in the database; keep the first of any duplicates.
    const seen = new Set<string>()
    const exercises = backup.exercises.filter((e) => {
      const k = e.name
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    await db.exercises.bulkAdd(exercises)
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
