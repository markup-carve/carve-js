import { expect, it } from 'vitest'
import { parse } from '../src/index.js'

const tight = (src: string): boolean => {
  const list = parse(src).children[0]
  if (list?.type !== 'list') throw new Error('expected a list')
  return list.tight
}

it('loosens the item when the note after the blank holds a line block (carve-js#4539)', () => {
  expect(tight('- r[^n]\n\n  [^n]: ::: |\n    x\n- b\n')).toBe(false)
})

it('loosens it when the note body runs past its first line', () => {
  expect(tight('- r[^n]\n\n  [^n]: x\n    y\n- b\n')).toBe(false)
  expect(tight('- r[^n]\n\n  [^n]: x\n\n    y\n- b\n')).toBe(false)
})

it('keeps the item tight with no blank before the note', () => {
  expect(tight('- r[^n]\n  [^n]: ::: |\n    x\n- b\n')).toBe(true)
  expect(tight('- r[^n]\n  [^n]: x\n    y\n- b\n')).toBe(true)
})
