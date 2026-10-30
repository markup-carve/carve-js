import { describe, expect, it } from 'vitest'
import { parse as parseDjot, renderHTML as renderDjot } from '@djot/djot'
import { carveToHtml, djotToCarve, lintCarve, markdownToCarve, parse, renderCarve } from '../src/index.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

describe('a continuation row whose closing pipe stays inside an open run (#3976)', () => {
  it.each([
    ['| a | b |\n+ c` |\n+ x | y |\n', '| a | b |\n+ c` |\n+ x | y` | |'],
    ['| a | b |\n+ c` | d |\n+ x | y |\n', '| a | b |\n+ c` | d |\n+ x | y` | |'],
    ['| a | b | c |\n+ x | y` |\n+ p | q | r |\n', '| a | b | c |\n+ x | y` |\n+ p | q | r` | |'],
    ['| a | b |\n+ ``c |\n+ x `` y | z |\n', '| a | b |\n+ `c |\n+ x ` y | z |'],
  ])('writes no padding cell: %j', (source, expected) => {
    const written = renderCarve(parse(source)).trim()
    expect(written).toBe(expected)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
  })

  it('keeps the padding of a row with no open run', () => {
    expect(renderCarve(parse('| a | b |\n+ c |\n')).trim()).toBe('| a | b |\n+ c | |')
  })
})

describe('an unclosed Djot code span with a fence run on its next line (#3991)', () => {
  it.each(['a\n`\n```\n', '`\n```\n', 'a\n`\n``` foo\n', 'a\n`\n```  bar\n'])('renders what Djot renders: %j', (source) => {
    const decoded = carveToHtml(djotToCarve(source)).trim()
      .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    const expected = renderDjot(parseDjot(source)).trim()
    expect(decoded).toBe(expected)
  })
})

describe('an interior whitespace run keeps the heading it sits in (#4026)', () => {
  it.each([
    ['# h   x\n', '<h1>h   x</h1>'],
    ['# h\t x {.c}\n', '<h1>h\t x {.c}</h1>'],
    ['# h   {.c}   \n', '<h1>h   {.c}</h1>'],
    ['# \t h\n', '<h1>\t h</h1>'],
  ])('%j', (source, heading) => {
    expect(carveToHtml(source).replace(/ id="[^"]*"/g, '')).toContain(heading)
  })

  const run = ' '.repeat(1000)
  perfIt('parse', () => expectScansLinearly(input => void parse(input), ' ', { prefix: '# h', suffix: 'x\n' }))
  perfIt('lint', () => expectScansLinearly(input => void lintCarve(input), ' ', { prefix: '# h', suffix: 'x\n' }))
  perfIt('Markdown import', () => expectScansLinearly(input => void markdownToCarve(input), ' ', { prefix: '# h', suffix: 'x\n' }))
  perfIt('Djot import', () => expectScansLinearly(input => void djotToCarve(input), ' ', { prefix: `: d${run}`, suffix: 'x\n' }))
})
