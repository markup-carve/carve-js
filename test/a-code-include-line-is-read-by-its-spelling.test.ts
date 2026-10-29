import { describe, expect, it } from 'vitest'
import { carveToHtml, expandIncludes, parse, renderHtml, resolve } from '../src/index.js'

// PART 10 I2 (carve#3759): a standalone `@code` directive is a code include by
// its spelling, so an unknown or malformed option leaves it literal on its own line.
describe('a code include line is read by its spelling', () => {
  it.each([
    ['an unknown key', '{{ data/p2.csv @code:csv @lins:2-1 }}'],
    ['an unknown bare key', '{{ a.csv @code @foo }}'],
    ['a key glued to a range', '  {{ data/p2.csv @code:csv @lines01-2 }}'],
    ['a malformed language', '{{ data/p2.csv @code::csv @liness:0-2 }}'],
    ['a section beside it', '{{ a.csv #sec @code:csv }}'],
    ['a repeated key', '{{ a.csv @code:csv @code:js }}'],
  ])('%s', (_name, line) => {
    expect(carveToHtml(`${line}\nmore\n`)).toBe(`<p>${line.trim()}</p>\n<p>more</p>`)
  })

  it('reads a quoted path as inline content but still ends at its line', () => {
    expect(carveToHtml('{{ "a b.csv" @code @foo }}\n^ cap\n'))
      .toBe('<p>{{ “a b.csv” <span class="mention"><strong>@code</strong></span> <span class="mention"><strong>@foo</strong></span> }}</p>\n<p>^ cap</p>')
  })

  it('keeps a bare code directive literal inside a sentence', () => {
    expect(carveToHtml('See {{ a.csv @code @foo }} here.\n')).toBe('<p>See {{ a.csv @code @foo }} here.</p>')
  })

  it('warns and stays literal when a resolver is configured', () => {
    const source = '{{ a.csv @code @foo }}\nmore\n'
    const result = expandIncludes(parse(source, { positions: true }), source, { resolve: () => 'x,y\n' })
    expect(renderHtml(resolve(result.doc))).toBe('<p>{{ a.csv @code @foo }}</p>\n<p>more</p>')
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})
