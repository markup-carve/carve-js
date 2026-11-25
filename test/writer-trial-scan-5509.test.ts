import { describe, expect, it } from 'vitest'
import { format } from '../src/index.ts'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.ts'

// carve-js#5509, C2-W-010: each C2-W-125 trial of a round asked whether the parse opened a braced construct on its
// brace by walking the whole parse, so a paragraph with a trial per unit cost the square of its length.
const UNIT = '{{*x*\\} {{{x*} '

function paragraph(units: number): string {
  return `${UNIT.repeat(units).trimEnd()}\n`
}

describe('C2-W-125 trials of a long paragraph (carve-js#5509)', () => {
  it('writes every unit after the first the same', () => {
    const written = format(paragraph(40))
    expect(written).toBe(`${['{{*x\\*} {{{x*}', ...Array<string>(39).fill('\\{{*x\\*} {{{x*}')].join(' ')}\n`)
    expect(format(written)).toBe(written)
  })

  perfIt('scales linearly in the units', () => {
    expectBuiltInputScansLinearly(source => { format(source) }, paragraph,
      { label: 'braced strong units', smallRepeats: 2_048, largeRepeats: 8_192 })
  })
})
