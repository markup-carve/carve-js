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
const WITH_PARAGRAPH_TRANSFORM = new Set(['U-015#0', 'U-102#1', 'U-129#2', 'U-129#7',
  'U-235#0', 'U-237#0', 'U-238#0'])
const WITH_TASK_TRANSFORM = new Set(['U-117#0', 'U-117#1', 'U-117#2'])
const UNVERIFIED_REPORTS = new Set([
  'U-059#0', 'U-060#0', 'U-061#0', 'U-130#0', 'U-130#1', 'U-130#2', 'U-130#3',
  'U-132#0', 'U-134#0', 'U-146#0', 'U-146#1', 'U-146#2', 'U-146#3',
  'U-146#4', 'U-147#0', 'U-149#0', 'U-150#0', 'U-154#0', 'U-160#0', 'U-160#1',
  'U-169#0', 'U-195#0', 'U-206#2', 'U-209#0', 'U-209#1', 'U-209#2', 'U-209#3',
  'U-219#0', 'U-219#1', 'U-219#2', 'U-219#3', 'U-219#4', 'U-221#0', 'U-221#1',
  'U-221#2', 'U-224#0', 'U-224#1', 'U-224#2', 'U-224#3', 'U-224#4', 'U-251#0',
  'U-252#0',
])

/**
 * Inputs where the 0.2 engine or the 0.1 engine does not do what the contract states. Each is in
 * _SPEC_GAPS.md under "Contract entries that do not hold"; the test pins what the tool does.
 */
const DOES_NOT_HOLD: Record<string, { output?: string; entry?: string; check: string }> = {
  // 0.1 makes this one-item list loose, which is U-021.
  'U-046#1': { entry: 'U-021', check: 'explained' },
  // Left as it is, 0.2 writes the key as `loose=""` on the list, so the tool removes it (U-020) and reports U-021.
  'U-021#0': { output: '- Note text.\n', entry: 'U-021', check: 'explained' },
  // 0.1 opens a second anonymous div at the last line; 0.2 closes the outer block there.
  'U-114#4': { entry: 'U-114', check: 'mismatch' },
  // C2-B-119: the div name ends at its character set, so 0.2 writes the class `e` as 0.1 does.
  'U-156#0': { check: 'pass' },
  // C2-I-111: the run is decided as a whole, so 0.2 writes four en dashes as 0.1 does.
  'U-173#0': { check: 'pass' },
  // C2-I-034, C2-B-101: an invalid brace block makes no list marker, so 0.2 reads the paragraph of 0.1.
  'U-208#0': { check: 'pass' },
  // Withdrawn with U-156, U-173 and U-208: the source gives the same HTML in 0.1 and 0.2 (C2-I-072, C2-B-090, C2-I-033).
  'U-183#0': { check: 'pass' },
  'U-196#0': { check: 'pass' },
  'U-231#0': { check: 'pass' },
}

/** U-014, U-015, and U-113#1 produce source that 0.1 reads differently on a second run. */
const NOT_IDEMPOTENT = new Set(['U-014#0', 'U-015#0', 'U-113#1', 'U-167#0',
  'U-129#8', 'U-129#9', 'U-129#10', 'U-129#11',
  'U-228#0', 'U-228#1', 'U-228#2'])

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
          if (known.entry === undefined) expect(entries(input)).toEqual([])
          else expect(entries(input)).toContain(known.entry)
        })
      } else if (entry.class === 'rewrite' || entry.class === 'escape') {
        it(`${key} gives the output of the contract and keeps the HTML`, () => {
          const result = upgrade(input)
          expect(result.output).toBe(entry.outputs[index])
          expect(result.check).toBe(WITH_REPORT.has(key) || WITH_PARAGRAPH_TRANSFORM.has(key)
            || WITH_TASK_TRANSFORM.has(key) ? 'explained' : 'pass')
          expect(entries(input)).toContain(entry.id)
        })
      } else if (entry.class === 'report') {
        it(`${key} is reported`, () => {
          const result = upgrade(input)
          const expectedOutput = key === 'U-133#0' ? '- [ ] {% %}' : (entry.outputs[index] ?? input)
          expect(result.output).toBe(expectedOutput)
          if (key === 'U-133#0') expect(entries(input)).toContain('U-122')
          else expect(entries(input)).toContain(entry.id)
          if (UNVERIFIED_REPORTS.has(key)) {
            expect(result.check).toBe('mismatch')
            expect(entries(input)).toContain('upgrade-mismatch')
          } else expect(result.check).not.toBe('mismatch')
        })
      } else {
        it(`${key} reads the same and is left alone`, () => {
          const result = upgrade(input)
          expect(result.output).toBe(input)
          expect(result.check).toBe('pass')
        })
      }
      const stability = NOT_IDEMPOTENT.has(key)
        ? 'is changed again by a second run (U-018 reads the output)'
        : 'is stable under a second run'
      it(`${key} ${stability}`, () => {
        const first = upgrade(input).output
        const second = upgrade(first).output
        if (NOT_IDEMPOTENT.has(key)) expect(second).not.toBe(first)
        else expect(second).toBe(first)
      })
    })
  }

  it('covers all 231 entries', () => {
    expect(cases.length).toBe(231)
  })
})
