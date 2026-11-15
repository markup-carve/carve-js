import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-090, C2-B-100, C2-B-101 empty attribute boundaries', () => {
  const cases: [string, string, string][] = [
    ['- {.k}\ntail\n', '- {% %}\n\ntail\n', 'U-137'],
    ['- {.a}\ntail\n', '- {% %}\n\ntail\n', 'U-137'],
    [':: t\n: {empty}\nflush\n', ':: t\n: {% %}\n\nflush\n', 'U-142'],
    ['-{} A bare item via the empty block.\n', '- A bare item via the empty block.\n', 'U-137']
  ]
  for (const [source, output, entry] of cases) {
    it(`${entry} keeps the next block outside the empty owner`, () => {
      const result = upgrade(source)
      expect(result.output).toBe(output)
      expect(result.check).toBe('pass')
      expect(result.records.map((record) => record.entry)).toContain(entry)
    })
  }

  it('U-208, C2-I-034: a braced insertion after a dash needs no escape, as no engine reads a list item', () => {
    const result = upgrade('-{+a+} text\n')
    expect(result.output).toBe('-{+a+} text\n')
    expect(result.check).toBe('pass')
  })
})
