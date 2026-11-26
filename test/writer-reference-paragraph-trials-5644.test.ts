// carve-js#5644: the reference trials of a group are read back on the paragraph that holds each reference.
import { expect, it } from 'vitest'
import { format } from '../src/index.ts'

const authored = (n: number): string => `^[/\\\`[\`[/[^]]][k] word${n} [x][foo  bar]`
const escaped = (n: number): string => `^\\[\\/\\\`[\\\`\\[\\/\\[^\\]\\]][k] word${n} [x][foo  bar]`
const definitions = '[foo bar]: /u\n\n[k]: /k\n'

it.each([
  ['a loose list', (write: (n: number) => string, n: number) => `- ${write(n)}`, '\n\n'],
  ['a quote', (write: (n: number) => string, n: number) => `> ${write(n)}`, '\n>\n'],
])('C2-W-075, C2-W-088: in %s each reference takes its verbatim text where it reads back', (_, line, between) => {
  const input = [0, 1, 2].map((n) => line(authored, n)).join(between) + `\n\n${definitions}`
  const once = format(input)
  expect(once).toBe([0, 1, 2].map((n) => line(escaped, n)).join(between) + `\n\n${definitions}`)
  expect(format(once)).toBe(once)
})

it('C2-W-075: past 32 trials the references of a group keep their tree spelling', () => {
  const items = Array.from({ length: 20 }, (_, n) => n)
  const once = format(items.map((n) => `- ${authored(n)}`).join('\n\n') + `\n\n${definitions}`)
  // Two references an item: the trials reach item 15.
  const expected = items.map((n) => `- ${escaped(n)}`.replace('[foo  bar]', n < 16 ? '[foo  bar]' : '[foo bar]'))
  expect(once).toBe(expected.join('\n\n') + `\n\n${definitions}`)
  expect(format(once)).toBe(once)
})
