import { describe, expect, it } from 'vitest'
import { lint } from './lint.ts'

// carve-js#5280: the open colon containers of a line were found by walking every container of the document.
const best = (source) => {
  let fastest = Infinity
  for (let run = 0; run < 3; run++) {
    const started = performance.now()
    lint(source)
    fastest = Math.min(fastest, performance.now() - started)
  }
  return fastest
}

describe('colon fence lines in linear time', () => {
  for (const [name, unit] of [['bare runs', ':::\n'], ['runs in quotes', '> :::\n> x\n'], ['closed divs', '::: d\nx\n:::\n\n']]) {
    it(`lints 8 times the ${name} in at most about 8 times the time`, () => {
      const small = unit.repeat(Math.ceil(4000 / unit.length))
      const large = unit.repeat(Math.ceil(32000 / unit.length))
      lint(small)
      expect(best(large)).toBeLessThan(Math.max(best(small), 2) * 24)
    }, 60_000)
  }

  it('keeps the diagnostics of a run of bare fences', () => {
    expect(lint(':::\n:::\n:::\n').map((entry) => entry.code)).toEqual(['unclosed-container-fence'])
  })
})
