import { describe, expect, it } from 'vitest'
import { parse, renderHtml, resolve, toAstJson } from '../src/index.js'

const cases = [
  ['CRLF', 'alpha\r\n', 'alpha\n', 7],
  ['Unicode CRLF', '🙂\r\n', '🙂\n', 6],
  ['BOM', '\ufeffa\n', 'a\n', 5],
  ['NUL', 'a\0b\n', 'a\ufffdb\n', 4],
  ['mixed line endings', 'a\rb\r\n', 'a\nb\n', 5],
  ['combined normalization', '\ufeff🙂\0\r\n', '🙂\ufffd\n', 10],
] as const

describe('source byte length before normalization', () => {
  for (const [name, source, normalized, bytes] of cases) {
    it(name, () => {
      for (const positions of [true, false]) {
        const document = parse(source, { positions })
        expect(toAstJson(document).srcByteLength).toBe(bytes)
        expect(renderHtml(resolve(document))).toBe(renderHtml(resolve(parse(normalized))))
      }
    })
  }
})
