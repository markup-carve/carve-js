import { describe, expect, it } from 'vitest'
import { format } from '../src/index.ts'

describe('carve-js#5715: a backslash the prune took out stays out when a verbatim reference is restored', () => {
  // C2-W-003, C2-W-075: the verbatim text of a reference is put back after the rounds; the text beside it keeps the
  // escapes the rounds left, and fmt with the sidecar writes what it writes without it (C2-W-127).
  const cases: [string, string][] = [
    ['[{\\%[^]^[[^[]%}][\\^]', '\\[\\{%[^]^\\[[\\^\\[\\]%}][\\^]\n'],
    ['\\[\\{%[^]^\\[[\\^\\[\\]%}][\\^]', '\\[\\{%[^]^\\[[\\^\\[\\]%}][\\^]\n'],
    [`${'> '.repeat(201)}[*][>]/*{\n}\\*/`, `${'> '.repeat(201)}[\\*][>]/\\*{\n${'> '.repeat(200)}}*/\n`],
  ]
  for (const [input, written] of cases) {
    it(`writes ${JSON.stringify(input.slice(-30))} once and keeps it`, () => {
      const once = format(input)
      expect(once).toBe(written)
      expect(format(once)).toBe(once)
      expect(format(once, { normalize: true })).toBe(once)
    })
  }
})
