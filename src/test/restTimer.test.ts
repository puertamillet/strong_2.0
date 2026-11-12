import { describe, expect, it } from 'vitest'
import { afterMoving, afterRemoving, followIndex } from '../lib/restTimer'

describe('a running rest follows its set', () => {
  it('moves up when a set above it is deleted, and is left without a set when its own is', () => {
    // Deleting the 2nd set of the 1st exercise of workout "w".
    const follow = (key: string | undefined) => followIndex(key, 'w:0:', afterRemoving(1))
    expect(follow('w:0:0')).toBe('w:0:0')
    expect(follow('w:0:1')).toBeUndefined()
    expect(follow('w:0:3')).toBe('w:0:2')
    // Other exercises and workouts, and a rest of no set, stay as they are.
    expect(follow('w:1:3')).toBe('w:1:3')
    expect(follow('w:10:3')).toBe('w:10:3')
    expect(follow('v:0:3')).toBe('v:0:3')
    expect(follow(undefined)).toBeUndefined()
  })

  it('goes with its exercise when exercises are moved or deleted', () => {
    expect(followIndex('w:2:1', 'w:', afterRemoving(0))).toBe('w:1:1')
    expect(followIndex('w:0:1', 'w:', afterRemoving(0))).toBeUndefined()
    expect(followIndex('w:1:4', 'w:', afterMoving(1, 2))).toBe('w:2:4')
    expect(followIndex('w:2:4', 'w:', afterMoving(1, 2))).toBe('w:1:4')
    expect(followIndex('w:3:0', 'w:', afterMoving(1, 2))).toBe('w:3:0')
  })

  it('maps every index like the list it follows', () => {
    const list = ['a', 'b', 'c', 'd', 'e']
    for (const [from, to] of [
      [1, 3],
      [3, 1],
      [0, 1],
      [4, 3],
    ]) {
      const moved = [...list]
      const [item] = moved.splice(from, 1)
      moved.splice(to, 0, item)
      list.forEach((x, i) => expect(moved[afterMoving(from, to)(i)]).toBe(x))
    }
    const removed = list.filter((_, i) => i !== 2)
    list.forEach((x, i) => {
      const at = afterRemoving(2)(i)
      if (i === 2) expect(at).toBeUndefined()
      else expect(removed[at!]).toBe(x)
    })
  })
})
