import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual } from '../src/index.ts'

// CC-1480 to CC-1484, pinned by markup-carve/carve#6311 ahead of this engine's spec-data pin.
const cases = [
  { id: 'CC-1480', input: 'v. x\n\n{x}\nvi. y\n', expected: 'v. x\n\n{x}\nvi. y\n' },
  { id: 'CC-1481', input: 'a. x\n\n\n{x}\n1. y\n', expected: 'a. x\n\n{x}\n1. y\n' },
  { id: 'CC-1482', input: '> v. x\n>\n> {x}\n> vi. y\n', expected: '> v. x\n>\n> {x}\n> vi. y\n' },
  { id: 'CC-1483', input: '- q\n\n  v. x\n\n  {x}\n  vi. y\n', expected: '- q\n\n  v. x\n\n  {x}\n  vi. y\n' },
  { id: 'CC-1484', input: 'v. x\n\n{#i}\n{.c}\nvi. y\n', expected: 'v. x\n\n{#i .c}\nvi. y\n' },
] as const

describe('an attribute line at an ordered-list style boundary', () => {
  it('writes the five pinned clause cases and preserves their trees', () => {
    expect(cases).toHaveLength(5)
    for (const { id, input, expected } of cases) {
      const written = format(input)
      expect(written, id).toBe(expected)
      expect(treesEqual(parse(written), parse(input)), id).toBe(true)
      expect(format(written), id).toBe(written)
    }
  })

  it('keeps the boundary for ordered styles, attributes, and container prefixes', () => {
    const first = ['v. x', 'a. x', 'i. x', 'A. x', 'V. x', '1. x']
    const second = ['vi. y', '1. y', 'b. y', 'I. y', '2. y']
    const attrs = ['{x}', '{#i}', '{.c}', '{k=v}', '{#i .c}', '{start=7}']
    const prefixes = ['', '> ', '- q\n\n  ']
    const contents = ['y', '[y](u)']
    let checked = 0
    for (const left of first) for (const marker of second) for (const attr of attrs) for (const prefix of prefixes) {
      for (const content of contents) {
        const right = marker.replace(' y', ` ${content}`)
        const input = prefix === '> '
          ? `> ${left}\n>\n> ${attr}\n> ${right}\n`
          : prefix === '' ? `${left}\n\n${attr}\n${right}\n`
            : `- q\n\n  ${left}\n\n  ${attr}\n  ${right}\n`
        const written = format(input)
        expect(treesEqual(parse(written), parse(input)), input).toBe(true)
        expect(format(written), input).toBe(written)
        checked++
      }
    }
    expect(checked).toBe(1080)
  })
})
