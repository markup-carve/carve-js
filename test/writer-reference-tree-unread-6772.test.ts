// carve#6772: a group whose tree spelling does not read back keeps its references from the tree without one trial each.
import { expect, it } from 'vitest'
import { format } from '../src/index.ts'

it('C2-W-075, C2-W-088: a group that does not read back from the tree keeps the tree spelling of its references', () => {
  const input = '::: figure\n::: figure\n![a](a.png)\n^ (a) First\n:::\n^ Figure #: Both\n\n| a |\n%% x\n+ b |\n\n![a \\*b\\*][r]\n'
  const once = format(input)
  expect(once).toBe(':::: figure\n{.figure}\n:::\n![a](a.png)\n^ (a) First\n:::\n\n\\^ Figure #: Both\n\n| a |\n+ b |\n%% x\n+ |\n\n![a *b*][r]\n::::\n')
  expect(format(once)).toBe(once)
})
