import { describe, expect, it } from 'vitest'
import { carveToAnsi } from '../src/index.js'

/*
 * A §26 bidi control must not occupy a cell in any ANSI width.
 *
 * The controls are stripped from this target's output, but that happens once
 * over the assembled string at the end of renderAnsi, while every width is
 * computed before it. So the heading rule and the table columns were measured
 * against characters that were about to be deleted.
 *
 * This was found as a cross-engine difference rather than by review: the spec
 * corpus case 119-trojan-source-heading-ids-…-3 rendered 45 bytes here and 42
 * in carve-rs and carve-php, which strip per text node (carve#1085).
 */

const RLO = '‮'
const ZWSP = '​'
const RULE = /═/g

describe('ANSI widths ignore bidi controls', () => {
  it('a heading rule is as wide as the text that survives', () => {
    const withControl = carveToAnsi(`# A${RLO}B${ZWSP}C\n`)
    const without = carveToAnsi(`# AB${ZWSP}C\n`)
    expect(withControl).toBe(without)
    expect((withControl.match(RULE) ?? []).length).toBe(4)
  })

  it('a table column is as wide as the text that survives', () => {
    // The control sits in the widest cell, so a miscount would pad every other
    // row to match it.
    const withControl = carveToAnsi(`| a${RLO}bcd | x |\n| ---- | - |\n| e | y |\n`)
    const without = carveToAnsi(`| abcd | x |\n| ---- | - |\n| e | y |\n`)
    expect(withControl).toBe(without)
  })

  it('CONTROL: a document with no bidi control is unaffected', () => {
    // No mutation of the width path breaks this one - it is here to show the
    // fix is scoped to the controls and not a general change to measurement.
    const out = carveToAnsi('# Title\n')
    expect((out.match(RULE) ?? []).length).toBe(5)
  })
})
