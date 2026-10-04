import { describe, expect, it } from 'vitest'
import { ScopedFenceClosers } from '../src/scoped-fence-closers.js'

describe('scoped fence closers', () => {
  it('matches fresh scans for every subrange and fence width', () => {
    const code = /^[ \t]*(`+|~+)[ \t]*$/
    const comment = /^[ \t]*(%{3,})(?:[ \t].*)?$/
    const colon = /^[ \t]*(:{3,})[ \t]*$/
    const lines = ['text', '```', '~~~~\t', '``` text', '  ````` ', '%%%', '%%%% tail', '  %%%', ':::','::::', '']
    const index = new ScopedFenceClosers(lines, code, comment, colon)
    for (let start = 0; start <= lines.length; start++) {
      for (let end = start; end <= lines.length; end++) {
        for (const width of [1, 3, 4, 5, 8]) {
          for (const character of ['`', '~']) {
            const expected = lines.slice(start, end).some(line => {
              const match = code.exec(line)
              return match !== null && match[1]![0] === character && match[1]!.length >= width
            })
            expect(index.codeIn(character.repeat(width), start, end)).toBe(expected)
          }
          for (const [kind, pattern] of [['comment', comment], ['colon', colon]] as const) {
            let expected: number | undefined
            for (let at = start; at < end; at++) {
              const match = pattern.exec(lines[at]!)
              if (match?.[1]?.length === width) expected = at
            }
            expect(index.last(kind, width, start, end)).toBe(expected)
          }
        }
      }
    }
  })
})
