// The two gates of the writer (C2-W-002, C2-W-003), with and without the sidecar, on the example
// inputs of the specification and on the small enumerations. The larger ones run in
// scripts/writer-gates.ts.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LINE_SHAPES } from './support/enumerate.ts'
import { INLINE_TOKENS } from './support/inline-enumerate.ts'
import { checkWriter, enumerateWriter } from './support/writer-checks.ts'

interface Example {
  file: string
  number: number
  input: string
}

const EXAMPLES = JSON.parse(readFileSync(new URL('../data/examples.json', import.meta.url), 'utf8')) as Example[]

describe('the gates of the writer', () => {
  it('C2-W-002, C2-W-003, C2-W-088: every example input of the specification', () => {
    const failures = EXAMPLES.map((example) => [`${example.file} ${example.number}`, checkWriter(example.input)]).filter((entry) => entry[1] !== null)
    expect(failures).toEqual([])
  })

  it('C2-W-002, C2-W-003, C2-W-088: every document of up to 2 lines', () => {
    for (const lines of [1, 2]) expect(enumerateWriter(LINE_SHAPES, lines, '\n', '').failures).toEqual([])
  })

  it('C2-W-002, C2-W-003, C2-W-088: every content of up to 2 inline tokens', () => {
    for (const tokens of [1, 2]) expect(enumerateWriter(INLINE_TOKENS, tokens, '', 'x').failures).toEqual([])
  })

  it('C2-W-016: a code span whose later line would open a block is refused, not written wrong', () => {
    expect(checkWriter('  - a\n- ```\n- a')).toBe('refused')
  })
})
