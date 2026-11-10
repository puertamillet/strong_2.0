import { db, newId } from './db'
import { CATALOG_EXERCISES } from './lib/catalog'
import { exerciseFromCatalog } from './lib/exercises'

/** A new device starts with the exercises of the catalog. */
export async function seedIfEmpty(): Promise<void> {
  await db.transaction('rw', db.exercises, async () => {
    if ((await db.exercises.count()) > 0) return
    const now = Date.now()
    await db.exercises.bulkAdd(CATALOG_EXERCISES.map((c) => exerciseFromCatalog(c, newId(), now)))
  })
}
