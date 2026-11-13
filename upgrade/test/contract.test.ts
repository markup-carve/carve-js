// Every input of the contract (upgrade-contract.md, extracted into contract.json) against the
// tool: a rewrite or an escape gives the contract's output and the self-check passes, a report
// entry leaves the text and is named, and a `none` entry changes nothing.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

interface Case {
  id: string
  class: 'rewrite' | 'escape' | 'report' | 'none'
  inputs: string[]
  outputs: string[]
}

const cases = JSON.parse(readFileSync(join(import.meta.dirname, 'contract.json'), 'utf8')) as Case[]

/** U-053: the contract's input is also a one-item loose list, so U-021 explains a difference. */
const WITH_REPORT = new Set(['U-053#0'])

/**
 * Inputs where the 0.2 engine or the 0.1 engine does not do what the contract states. Each is in
 * _SPEC_GAPS.md under "Contract entries that do not hold"; the test pins what the tool does.
 */
const DOES_NOT_HOLD: Record<string, { output?: string, entry: string, check: string }> = {
  // 0.2 reads the marker left of the list's column as a lazy line, so the tool moves it (U-023).
  'U-029#1': { output: '- a\n- b\n', entry: 'U-023', check: 'pass' },
  // 0.1 makes this one-item list loose, which is U-021.
  'U-046#1': { entry: 'U-021', check: 'explained' },
  // Left as it is, 0.2 writes the key as `loose=""` on the list, so the tool removes it (U-020) and reports U-021.
  'U-021#0': { output: '- Note text.\n', entry: 'U-021', check: 'explained' },
  // 0.1 opens a second anonymous div at the last line; 0.2 closes the outer block there.
  'U-114#4': { entry: 'upgrade-mismatch', check: 'mismatch' },
}

/** U-014 and U-015 write the input of U-018, so a second run reads their output as a loose list. */
const NOT_IDEMPOTENT = new Set(['U-014#0', 'U-015#0'])

function entries(input: string): string[] {
  return upgrade(input).records.map((record) => record.entry)
}

describe('the contract', () => {
  for (const entry of cases) {
    entry.inputs.forEach((input, index) => {
      const key = `${entry.id}#${index}`
      const known = DOES_NOT_HOLD[key]
      if (known !== undefined) {
        it(`${key} does not hold as stated`, () => {
          const result = upgrade(input)
          expect(result.output).toBe(known.output ?? input)
          expect(result.check).toBe(known.check)
          expect(entries(input)).toContain(known.entry)
        })
      } else if (entry.class === 'rewrite' || entry.class === 'escape') {
        it(`${key} gives the output of the contract and keeps the HTML`, () => {
          const result = upgrade(input)
          expect(result.output).toBe(entry.outputs[index])
          expect(result.check).toBe(WITH_REPORT.has(key) ? 'explained' : 'pass')
          expect(entries(input)).toContain(entry.id)
        })
      } else if (entry.class === 'report') {
        it(`${key} is reported and left as it is`, () => {
          const result = upgrade(input)
          expect(result.output).toBe(input)
          expect(entries(input)).toContain(entry.id)
          expect(result.check).not.toBe('mismatch')
        })
      } else {
        it(`${key} reads the same and is left alone`, () => {
          const result = upgrade(input)
          expect(result.output).toBe(input)
          expect(result.check).toBe('pass')
        })
      }
      it(`${key} ${NOT_IDEMPOTENT.has(key) ? 'is changed again by a second run (U-018 reads the output)' : 'is stable under a second run'}`, () => {
        const first = upgrade(input).output
        const second = upgrade(first).output
        if (NOT_IDEMPOTENT.has(key)) expect(second).not.toBe(first)
        else expect(second).toBe(first)
      })
    })
  }

  it('covers all 93 entries', () => {
    expect(cases.length).toBe(93)
  })
})
