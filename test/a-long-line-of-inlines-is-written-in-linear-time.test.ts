import { describe, expect, it } from 'vitest'
import { carveToCarve, htmlToCarve } from '../src/index.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

// The inline writer checked the end of its growing output line before every
// node, which flattened the whole line each time: quadratic in the number of
// nodes on one line.

describe('writing a long line of inline nodes', () => {
  it('keeps a boundary escape that sits past the end the writer tracks', () => {
    const name = 'n'.repeat(400)
    const src = `a \\:${name}[x]{.c}\n`
    expect(carveToCarve(src)).toBe(src)
  })

  it('counts a backslash run longer than the tracked end before a boundary character', () => {
    const run = '\\'.repeat(128)
    expect(htmlToCarve(`<p>a ${run}$<code>x</code></p>`).value).toBe(`a ${run}${run}\\$\`x\`\n`)
  })

  perfIt('writes a line of adjacent spans in linear time', () => {
    expectScansLinearly((input) => void carveToCarve(input), '[w]{.c}', {
      label: 'adjacent spans on one line',
      smallRepeats: 8000,
    })
  })

  perfIt('writes a line of escaped delimiters in linear time', () => {
    expectScansLinearly((input) => void carveToCarve(input), '\\*\\_\\[\\`x ', {
      label: 'escaped delimiters on one line',
      smallRepeats: 2500,
    })
  })
})
