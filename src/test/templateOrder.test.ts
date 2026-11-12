import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { db, type Template } from '../db'
import { saveTemplateOrder, sortTemplates } from '../lib/templateOrder'

const template = (id: string, name: string, order?: number): Template => ({
  id,
  name,
  exercises: [],
  updatedAt: 0,
  ...(order !== undefined && { order }),
})

describe('order of the templates', () => {
  it('goes by name until they are dragged, and puts new ones after the others', () => {
    const names = (ts: Template[]) => sortTemplates(ts).map((t) => t.name)
    expect(names([template('t', 'Torso'), template('b', 'Brazo'), template('h', 'Hombro')])).toEqual(['Brazo', 'Hombro', 'Torso'])
    expect(names([template('t', 'Torso', 0), template('b', 'Brazo', 1), template('a', 'Abdomen'), template('h', 'Hombro', 2)])).toEqual([
      'Torso',
      'Brazo',
      'Hombro',
      'Abdomen',
    ])
  })

  it('saves the order dragged, without changing anything else', async () => {
    await db.templates.clear()
    await db.templates.bulkAdd([template('t', 'Torso'), template('b', 'Brazo'), template('h', 'Hombro')])
    await saveTemplateOrder(['h', 't', 'b'])
    const saved = await db.templates.toArray()
    expect(sortTemplates(saved).map((t) => t.id)).toEqual(['h', 't', 'b'])
    expect(saved.every((t) => t.updatedAt === 0)).toBe(true)
  })
})
