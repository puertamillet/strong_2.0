import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CATALOG, catalogKey, MUSCLES, muscleGroup, parseCatalog } from '../lib/catalog'
import { parseCsv } from '../lib/csv'

describe('exercise catalog', () => {
  it('has one row per Strong name', () => {
    const names = CATALOG.map((e) => e.strong.toLowerCase())
    expect(new Set(names).size).toBe(names.length)
  })

  it('describes merged rows the same way', () => {
    const byKey = new Map<string, string[]>()
    for (const e of CATALOG) {
      const muscles = `${e.primary.join('+')}/${e.secondary.join('+')}`
      byKey.set(catalogKey(e), [...(byKey.get(catalogKey(e)) ?? []), muscles])
    }
    for (const [key, variants] of byKey) expect(new Set(variants).size, key).toBe(1)
  })

  it('never lists a muscle as both primary and secondary', () => {
    for (const e of CATALOG) expect(e.primary.filter((m) => e.secondary.includes(m)), e.strong).toEqual([])
  })

  it('groups every muscle in a body area', () => {
    for (const m of MUSCLES) expect(muscleGroup(m)).toBeTruthy()
    expect(muscleGroup('Cuádriceps')).toBe('Pierna')
    expect(muscleGroup('Deltoides lateral')).toBe('Hombro')
  })

  it('reports the line of a bad value', () => {
    const header = 'strong,nombre,material,lateralidad,principales,secundarios,revisar\n'
    expect(() => parseCatalog(header + 'Curl,Curl,Barra,Bilateral,Bíceps,,\nX,X,Palos,Bilateral,Bíceps,,\n')).toThrow(
      'línea 3: material desconocido «Palos»',
    )
    expect(() => parseCatalog(header + 'X,X,Barra,Bilateral,Bícep,,\n')).toThrow('músculo desconocido «Bícep»')
    expect(parseCatalog(header + 'X,X,Barra,Unilateral,Bíceps + Antebrazo,,\n')[0]).toMatchObject({
      laterality: 'Unilateral',
      primary: ['Bíceps', 'Antebrazo'],
      secondary: [],
    })
  })

  // Optional: STRONG_CSV=/path/to/strong.csv npm test checks that every exercise of a real export is in the catalog.
  it.skipIf(!process.env.STRONG_CSV)('covers every exercise of a real Strong export', () => {
    const [header, ...rows] = parseCsv(readFileSync(process.env.STRONG_CSV!, 'utf8'))
    const col = header.indexOf('Exercise Name')
    const known = new Set(CATALOG.map((e) => e.strong))
    const missing = [...new Set(rows.map((r) => r[col]).filter(Boolean))].filter((n) => !known.has(n))
    expect(missing).toEqual([])
  })
})
