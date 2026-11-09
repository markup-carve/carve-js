import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

// carve-js#4750: an open `{` run whose lines are all valid payload was rescanned whole per line.
describe('an unclosed brace run', () => {
  it('stays paragraph text', () => {
    expect(carveToHtml('{.x\n .a\n .a\n .a\n')).toBe('<p>{.x\n.a\n.a\n.a</p>')
  })

  const hosts: Record<string, string> = {
    root: '{.x\n',
    description: ':: t\n: +\n{.x\n',
    item: '- +\n{.x\n',
  }
  for (const [label, prefix] of Object.entries(hosts)) {
    perfIt(`parses an unclosed run at the ${label} in linear time`, () => {
      expectScansLinearly((input) => void carveToHtml(input), ' .a\n', { label, prefix, smallRepeats: 1000 })
    })
  }
})
