// carve-js#5201, carve#6772: the kind rounds read references from the tree, so their recorded text does not move escapes.
import { expect, it } from 'vitest'
import { format, parse, treesEqual } from '../src/index.ts'

it.each([
  ['^[/\\`[`[/[^]]][<]', '^\\[\\/\\`[\\`\\[\\/\\[^\\]\\]][<]\n'],
  ['^[*\\`[`[*[^]]][<]', '^\\[\\*\\`[\\`\\[\\*\\[^\\]\\]][<]\n'],
  ['^[/\\`[`[/[^]]][k]', '^\\[\\/\\`[\\`\\[\\/\\[^\\]\\]][k]\n'],
])('C2-W-003, C2-W-075, C2-W-088: %j formats as its normalized form and stays there', (input, expected) => {
  const once = format(input)
  expect(once).toBe(expected)
  expect(format(once)).toBe(once)
  expect(format(input, { normalize: true })).toBe(once)
  expect(treesEqual(parse(once), parse(input))).toBe(true)
})

it('C2-W-075: a recorded text that reads back is still written as authored', () => {
  expect(format('[x][foo  bar] and [y\\/z][k]\n\n[foo bar]: /u\n\n[k]: /k')).toBe('[x][foo  bar] and [y\\/z][k]\n\n[foo bar]: /u\n\n[k]: /k\n')
})
