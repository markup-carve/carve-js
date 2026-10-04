import { describe, expect, it } from 'vitest'
import { AttachmentFenceClosers, FailedScanRanges } from '../src/attachment-fence-closers.js'

function dedent(line: string, columns: number): string {
  let at = 0, column = 0
  while (column < columns && (line[at] === ' ' || line[at] === '\t')) {
    column += line[at] === '\t' ? 4 - column % 4 : 1
    at++
  }
  return line.slice(at)
}

describe('attachment closer column views', () => {
  it('matches direct scans for every range, width and dedent column', () => {
    const lines = ['text', '```', ' \t`````', '\t~~~', '  :::', '\t::::', '%%% tail', '  %%%', '```~', '    ```', ' \t ~~~~', ':::', ' ```x', '  ::: box']
    const code = /^[ \t]*(`{3,}|~{3,})[ \t]*$/
    const comment = /^[ \t]*(%{3,})(.*)$/
    const colon = /^[ \t]*(:{3,})[ \t]*$/
    const index = new AttachmentFenceClosers({ length: lines.length, lineAt: i => lines[i]! }, code, comment, colon, line => /^(`{3,}|~{3,})(?:x)?$/.test(line) || /^:{3,}(?: box)?$/.test(line))
    for (const column of [0, 1, 2, 3, 4, 5, 8]) {
      for (let start = 0; start <= lines.length; start++) {
        for (let end = start; end <= lines.length; end++) {
          const firstEvent = lines.findIndex((line, at) => {
            const view = dedent(line, column)
            return at >= start && at < end && (/^(`{3,}|~{3,})(?:x)?$/.test(view)
              || /^:{3,}(?: box)?$/.test(view) || comment.test(view))
          })
          expect(index.nextEvent(start, end, column)).toBe(firstEvent < 0 ? undefined : firstEvent)
          for (const width of [3, 4, 5, 8]) {
            for (const character of ['`', '~']) {
              const expected = lines.findIndex((line, at) => {
                const run = /^(`{3,}|~{3,})[ \t]*$/.exec(dedent(line, column))?.[1]
                return at >= start && at < end && run?.[0] === character && run.length >= width
              })
              expect(index.nextCode(character.repeat(width), start, end, column)).toBe(expected < 0 ? undefined : expected)
            }
            let last: number | undefined
            let firstComment: number | undefined
            for (let at = start; at < end; at++) {
              if (/^(:{3,})[ \t]*$/.exec(dedent(lines[at]!, column))?.[1]?.length === width) last = at
              if (firstComment === undefined && comment.exec(dedent(lines[at]!, column))?.[1]?.length === width) firstComment = at
            }
            expect(index.lastColon(width, start, end, column)).toBe(last)
            expect(index.nextComment(width, start, end)).toBe(firstComment)
          }
        }
      }
    }
  })
  it('handles empty and singleton views', () => {
    for (const lines of [[], ['```']]) {
      const index = new AttachmentFenceClosers({ length: lines.length, lineAt: i => lines[i]! }, /^(`{3,}|~{3,})$/, /^(%{3,})$/, /^(:{3,})$/)
      expect(index.nextCode('```', 0, lines.length, 0)).toBe(lines.length === 0 ? undefined : 0)
      expect(index.nextCode('x', 0, lines.length, 0)).toBeUndefined()
      expect(index.lastColon(3, 0, lines.length, 0)).toBeUndefined()
    }
  })
})

it('merges failed ranges without filling gaps, under shuffled inserts', () => {
  const ranges = new FailedScanRanges()
  const expected = new Set<number>()
  let seed = 2484
  for (let round = 0; round < 256; round++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const start = seed % 512, end = start + round % 7
    ranges.add(start, end)
    for (let position = start; position < end; position++) expected.add(position)
    for (let position = 0; position < 520; position++) expect(ranges.has(position)).toBe(expected.has(position))
  }
})

it('keeps monotone disjoint insertions logarithmic in depth', () => {
  for (const backwards of [false, true]) {
    const ranges = new FailedScanRanges()
    const count = 2048
    for (let at = 0; at < count; at++) {
      const position = (backwards ? count - at - 1 : at) * 3
      ranges.add(position, position + 1)
    }
    expect(ranges.depth).toBeLessThanOrEqual(Math.ceil(Math.log2(count + 1)) * 2)
    for (let at = 0; at < count; at++) {
      expect(ranges.has(at * 3)).toBe(true)
      expect(ranges.has(at * 3 + 1)).toBe(false)
    }
  }
})
