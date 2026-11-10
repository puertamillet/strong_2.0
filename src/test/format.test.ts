import { describe, expect, it } from 'vitest'
import { fmtClock, fmtNumber, fmtSet, parseNum, setLabel } from '../lib/format'
import { guessCategory } from '../seed'

describe('format', () => {
  it('parses numbers with comma or dot', () => {
    expect(parseNum('22,5')).toBe(22.5)
    expect(parseNum('22.5')).toBe(22.5)
    expect(parseNum(' 10 ')).toBe(10)
    expect(parseNum('')).toBeNull()
    expect(parseNum('abc')).toBeNull()
  })

  it('formats numbers, sets and clocks', () => {
    expect(fmtNumber(22)).toBe('22')
    expect(fmtNumber(22.5)).toBe('22,5')
    expect(fmtNumber(51.257)).toBe('51,26')
    expect(fmtNumber(1250)).toBe('1250')
    expect(fmtSet({ weight: 30, reps: 8 })).toBe('30 kg × 8')
    expect(fmtSet({ weight: 0, reps: 12 })).toBe('12 reps')
    expect(fmtClock(90)).toBe('1:30')
    expect(fmtClock(3725)).toBe('1:02:05')
  })

  it('labels sets like Strong', () => {
    expect(setLabel('warmup', 0)).toBe('C')
    expect(setLabel('normal', 2)).toBe('2')
    expect(setLabel('drop', 2)).toBe('D')
  })
})

describe('guessCategory', () => {
  it.each([
    ['Lying Leg Curl (Machine)', 'Pierna'],
    ['Reverse Fly (Machine)', 'Hombro'],
    ['Triceps Extension Overhead (Cable)', 'Brazo'],
    ['Lat Pulldown (Single Arm)', 'Espalda'],
    ['Calf Press on Seated Leg Press', 'Pierna'],
    ['Curl Bayesian (Cable)', 'Brazo'],
    ['Crunch (Machine)', 'Abdomen'],
    ['Hip Thrust (Barbell)', 'Pierna'],
    ['Incline Chest Fly (Cable)', 'Pecho'],
    ['Seated Overhead Press (Smith Machine)', 'Hombro'],
    ['Unilateral Pullover (Cable)', 'Espalda'],
    ['Unilateral LateraL Raise (Machine)', 'Hombro'],
  ])('%s → %s', (name, category) => {
    expect(guessCategory(name)).toBe(category)
  })
})
