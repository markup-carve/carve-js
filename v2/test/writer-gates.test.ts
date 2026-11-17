// The two gates of the writer (C2-W-002, C2-W-003), with and without the sidecar, on the example
// inputs of the specification and on the small enumerations. The larger ones run in
// scripts/writer-gates.ts.
import { describe, expect, it } from 'vitest'
import { CARVE_SOURCES } from '../scripts/corpus.ts'
import { LINE_SHAPES } from './support/enumerate.ts'
import { INLINE_TOKENS, WRITER_TOKENS } from './support/inline-enumerate.ts'
import { checkGates, checkWriter, enumerateWriter, seededRandom } from './support/writer-checks.ts'

describe('the gates of the writer', () => {
  it('C2-W-002, C2-W-003, C2-W-088: every example input of the specification', () => {
    const failures = CARVE_SOURCES.map((example) => [example.id, checkWriter(example.input)]).filter((entry) => entry[1] !== null)
    expect(failures).toEqual([])
  })

  it('C2-W-002, C2-W-003, C2-W-088: every document of up to 2 lines', () => {
    for (const lines of [1, 2]) expect(enumerateWriter(LINE_SHAPES, lines, '\n', '').failures).toEqual([])
  })

  it('C2-W-002, C2-W-003, C2-W-088: every content of up to 2 inline tokens', () => {
    for (const tokens of [1, 2]) expect(enumerateWriter(INLINE_TOKENS, tokens, '', 'x').failures).toEqual([])
  })

  it('C2-W-016: a code span whose later line would open a block is refused, not written wrong', () => {
    expect(checkWriter(':: t\n: a\n`x\n- a`')).toBe('refused')
  })
})

describe('the gates of the writer on its own token alphabet', () => {
  it('C2-W-002, C2-W-003: every content of up to 2 writer tokens, escaped backticks, escaped delimiters and code spans included', () => {
    for (const tokens of [1, 2]) {
      const result = enumerateWriter(WRITER_TOKENS, tokens, '', 'x')
      expect(result.failures).toEqual([])
      expect(result.refused).toBe(0)
    }
  })

  it('C2-W-011: in a seeded random run, no written form reads back as another tree without a reported loss', () => {
    const random = seededRandom(1)
    const silent: string[] = []
    for (let count = 0; count < 2000; count++) {
      let src = 'x'
      const pick = (): string => WRITER_TOKENS[Math.floor(random() * WRITER_TOKENS.length)]!
      for (let tokens = 5 + Math.floor(random() * 5); tokens > 0; tokens--) src += pick()
      const gates = checkGates(src)
      if (gates.failure !== null && gates.losses === null) silent.push(`${JSON.stringify(src)}: ${gates.failure}`)
    }
    expect(silent).toEqual([])
  })
})

describe('the gates on the comments of candidate 8', () => {
  it('C2-I-024, C2-W-002: a line comment that a bracket or a braced closer would end is not written silently past its reading', () => {
    for (const source of ['x#}\n%}\\[\\+ %% ]', '>{/-\n-{.c}%%\n%% a\\[(/u)/}\n- ```\n  %% a-}\n***--}\n: d-}']) {
      // A failure with a reported loss is no silent failure (C2-W-011).
      const result = checkGates(source)
      expect(result.failure === null || result.losses !== null, source).toBe(true)
    }
  })
})

describe('the gates on comments at the start and the end of a span', () => {
  it('C2-I-023, C2-I-024, C2-W-002: a span that starts or ends with a line comment, or a note-shaped bracket around one, reads back', () => {
    for (const source of ['x {*%%*}', 'x {/%%/}', 'x\n{*%%*}', 'x[{/%%/}', 'x\\^[%%]', 'x {*a %%*}', 'x(/u)\\{/%%', 'x\\{*%%*']) {
      expect(checkWriter(source, []), source).toBeNull()
    }
  })
})
