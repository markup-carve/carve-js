import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// Ruling A (carve#5855): an own-line `+` fence's payload is verbatim from the
// opener's column in every host; a blank does not re-measure the next line.
const hosts: Record<string, [string[], string, string, number?]> = {
  item: [['- p'], '', ''],
  'ordered item': [['1. p'], '', '', 3],
  note: [['[^a]: p'], '', '[^a]'],
  description: [[':: t', ': p'], '', ''],
  'nested item': [['- x', '', '  - p'], '  ', ''],
  'note in an item': [['- x', '', '  [^a]: p'], '  ', '[^a]'],
  'description in an item': [['- x', '', '  :: t', '  : p'], '  ', ''],
}
const code = (s: string) => [...s.matchAll(/<pre><code>([\s\S]*?)<\/code><\/pre>/g)].map((m) => m[1])

describe('an own-line plus fence keeps its payload columns after a blank (carve#5855)', () => {
  for (const [name, [head, pad, ref, body = 2]] of Object.entries(hosts)) for (const blanks of [1, 2]) {
    for (let indent = body; indent <= 4; indent++) {
      it(`${name}: a payload line at ${indent} after ${blanks} blank(s)`, () => {
        const tail = ' '.repeat(indent) + 'tail'
        const lines = [...(ref ? [`r${ref}`, ''] : []), ...head, pad + '+', pad + '```', pad + 'code',
          ...Array(blanks).fill(''), pad + tail, '', 'see']
        expect(code(carveToHtml(lines.join('\n') + '\n'))).toEqual(['code\n' + '\n'.repeat(blanks) + tail + '\n\n'])
      })
    }
  }
})
