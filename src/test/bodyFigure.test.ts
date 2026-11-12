import { describe, expect, it } from 'vitest'
import { FIGURES } from '../data/bodyFigure'
import { exercisePaint, heatLevel, heatPaint } from '../lib/bodyFigure'
import { MUSCLES } from '../lib/catalog'

describe('body figure', () => {
  it('has a place for every muscle on each body', () => {
    for (const sex of ['male', 'female'] as const) {
      const { front, back } = FIGURES[sex]
      const shown = new Set([...front.regions, ...back.regions].flatMap(([muscles]) => muscles.split('|')))
      expect(MUSCLES.filter((m) => !shown.has(m))).toEqual([])
    }
  })

  it('paints an exercise: main muscles first, then the ones that also work', () => {
    const paint = exercisePaint(['Pectoral'], ['Deltoides anterior', 'Tríceps'])
    expect(paint(['Pectoral'])).toBe('body-primary')
    expect(paint(['Deltoides anterior', 'Deltoides lateral'])).toBe('body-secondary')
    expect(paint(['Bíceps'])).toBe('body-body')
  })

  it('paints the weekly sets of each muscle in four shades', () => {
    expect([0, 1, 3, 4, 6, 7, 9, 10, 25].map(heatLevel)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4])
    const paint = heatPaint({ Pectoral: 5, 'Deltoides lateral': 12, 'Deltoides anterior': 2 })
    expect(paint(['Pectoral'])).toBe('body-heat-2')
    // A region of two muscles shows the most worked one.
    expect(paint(['Deltoides anterior', 'Deltoides lateral'])).toBe('body-heat-4')
    expect(paint(['Bíceps'])).toBe('body-body')
  })
})
