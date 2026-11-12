import { db, type Template } from '../db'

/** Templates in the order they were dragged into; the ones that never were (new ones), after, by name. */
export function sortTemplates(templates: Template[]): Template[] {
  return [...templates].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.name.localeCompare(b.name, 'es'))
}

/** Saves the order of all the templates, from the first to the last. */
export async function saveTemplateOrder(ids: string[]): Promise<void> {
  await db.transaction('rw', db.templates, async () => {
    for (const [order, id] of ids.entries()) await db.templates.update(id, { order })
  })
}
