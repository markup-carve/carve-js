import { describe, expect, it } from 'vitest'
import { parse } from '../src/index.js'
import { balancedLabelMatcher, RE_DIV_OPEN } from '../src/parse/parse-prepass-core.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

describe('block ownership on a line with an interior whitespace run', () => {
  it('reads a div opener as the pattern with one space quantifier always did', () => {
    const old = balancedLabelMatcher(/^(:{3,}) *(\[[^\n]*\])?[ \t]*$/, [2])
    const chars = [' ', '\t', ':', '[', ']', 'x', '\n']
    const check = (rest: string, depth: number): void => {
      const line = `:::${rest}`
      expect(RE_DIV_OPEN.exec(line)?.slice(1, 3), JSON.stringify(line)).toEqual(old.exec(line)?.slice(1, 3))
      if (depth > 0) for (const char of chars) check(rest + char, depth - 1)
    }
    check('', 5)
  })

  perfIt.each([
    ['caption', '^ x', 'x\n', ' '],
    ['caption tabs', '^ x', 'x\n', '\t'],
    ['bare colon fence', ':::', 'x\n', ' '],
    ['nested caption', '- a\n\n  ^ x', 'x\n', ' '],
    ['nested bare colon fence', '- a\n\n  :::', 'x\n', ' '],
    ['list item', '- x', 'x\n', ' '],
    ['block quote', '> x', 'x\n', ' '],
  ])('parses a %s in linear time', (label, prefix, suffix, repeated) => {
    expectScansLinearly((source) => void parse(source), repeated, {
      prefix, suffix, smallRepeats: 4000, minSampleMs: 250, label,
    })
  }, 30000)
})
