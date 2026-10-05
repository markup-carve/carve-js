import { expect, it } from 'vitest'
import { ColumnReservations } from '../src/column-reservations.js'

it.each([1, 37, 64])('matches column scans across sparse holds, overlapping extensions and expiry at limit %i', (limit) => {
  const index = new ColumnReservations(limit)
  const held = new Array<number>(limit).fill(0)
  expect(index.nextFree(0, 0)).toBe(0)
  expect(index.reach(0)).toBe(0)
  held[limit - 1] = 1
  index.hold(limit - 1, 1)
  expect(index.nextFree(limit - 1, 0)).toBe(limit)
  expect(index.reach(0)).toBe(limit)
  expect(index.nextFree(0, 1)).toBe(0)
  expect(index.reach(1)).toBe(0)
  for (let row = 0; row < 20; row++) {
    if (row < 12) for (let j = 0; j < 16; j++) {
      const col = (row * 17 + j * 13) % limit, end = row + 2 + j % 7
      held[col] = Math.max(held[col]!, end)
      index.hold(col, end)
    }
    let reach = 0
    for (let col = 0; col < limit; col++) if (held[col]! > row) reach = col + 1
    expect(index.reach(row)).toBe(reach)
    for (let from = 0; from <= limit + 1; from++) {
      let expected = from
      while ((held[expected] ?? 0) > row) expected++
      expect(index.nextFree(from, row)).toBe(expected)
    }
  }
})
