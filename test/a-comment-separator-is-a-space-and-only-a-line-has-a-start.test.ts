import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * THE TRAILING `%%` FORM TAKES A LITERAL SPACE, AND ONLY A LINE HAS A START
 * (markup-carve/carve-js#2305).
 *
 * `resources/examples/core.md` states the form as "a trailing `%%` (preceded by
 * a space or at the start of the line)", and the oracle reads both halves
 * strictly. This engine read neither: it took `[ \t\n]` for the separator, and
 * it took index 0 of whatever string the inline scanner held for a line start -
 * so a nested span, a table cell, a caption and an admonition title all carried
 * a comment where the oracle keeps the text.
 *
 * ONE RULE, TWO HALVES:
 *
 *   - the separator is U+0020 or the line break that puts `%%` first on a later
 *     line. A tab does not satisfy it, which is the same reading already pinned
 *     for the separator after a footnote, link reference and abbreviation
 *     definition marker;
 *   - a run that begins mid-line has no line start of its own.
 *
 * THE HEADING IS ITS OWN HOST and is unmoved. The spec's heading path strips
 * `(^|[ \t])%%` from the line before any inline read, so a tab and the line's
 * own start both separate there, and that strip also trims the whole trailing
 * whitespace run rather than the one separator. The rows below pin the heading
 * against the same oracle so a later narrowing there is a deliberate change.
 *
 * Measured against the oracle (`scripts/spec/layout.mjs` into
 * `scripts/spec/html.mjs` in markup-carve/carve at `b1a59237`, byte-identical at
 * the pinned `e24e38e9`), run rather than read. 877 of a 1764-shape sweep over
 * host x separator x nesting move onto it and none moves off.
 */
describe('a trailing comment needs its separator', () => {
  it('takes a literal space', () => {
    expect(carveToHtml('x %% b\n')).toBe('<p>x</p>')
  })

  it('takes the line break that puts it first on a later line', () => {
    expect(carveToHtml('x\n%% b\n')).toBe('<p>x</p>')
  })

  it('does not take a tab', () => {
    expect(carveToHtml('x\t%% b\n')).toBe('<p>x\t%% b</p>')
  })

  it('does not take a space that a tab stands between', () => {
    expect(carveToHtml('x \t%% b\n')).toBe('<p>x \t%% b</p>')
  })

  it('does not take a no-break space', () => {
    expect(carveToHtml('x %% b\n')).toContain('%% b')
  })

  it('takes nothing where the text runs straight into it', () => {
    expect(carveToHtml('x%% b\n')).toBe('<p>x%% b</p>')
  })

  // The separator is ONE character, so whatever whitespace stands in front of it
  // is ordinary text - the absorption cannot be a `[ \t]+` trim.
  it('absorbs the one separator and leaves the space in front of it', () => {
    expect(carveToHtml('x  %% b\n')).toBe('<p>x </p>')
  })

  it('leaves a tab in front of the separator', () => {
    expect(carveToHtml('x\t %% b\n')).toBe('<p>x\t</p>')
  })
})

describe('only a line has a start a comment can open at', () => {
  it('keeps a run that opens with it as emphasis text', () => {
    expect(carveToHtml('/%% b/\n')).toBe('<p><em>%% b</em></p>')
  })

  it('keeps it in a strong run', () => {
    expect(carveToHtml('*%% b*\n')).toBe('<p><strong>%% b</strong></p>')
  })

  it('keeps it in a link label', () => {
    expect(carveToHtml('[%% b](u)\n')).toBe('<p><a href="u">%% b</a></p>')
  })

  it('keeps it in an attributed span', () => {
    expect(carveToHtml('[%% b]{.c}\n')).toBe('<p><span class="c">%% b</span></p>')
  })

  it('keeps it in a table cell', () => {
    expect(carveToHtml('| %% b |\n')).toContain('<td>%% b</td>')
  })

  it('keeps it in a figure caption', () => {
    expect(carveToHtml('::: figure\n![a](i)\n^ %% b\n:::\n')).toContain('<figcaption>%% b</figcaption>')
  })

  it('keeps it in an admonition title', () => {
    expect(carveToHtml('::: note "%% b"\nx\n:::\n')).toContain('>%% b</p>')
  })

  // The separator inside the run is a real one, so the run's start is the only
  // thing this rule takes away.
  it('still comments behind a space inside the run', () => {
    expect(carveToHtml('/ %% b/\n')).toBe('<p>/</p>')
  })

  it('still comments behind a space after text inside a link label', () => {
    expect(carveToHtml('[x %% b](u)\n')).toBe('<p><a href="u">x</a></p>')
  })

  // A later line inside multi-line inline content keeps its newline separator,
  // which is carve#574's reading and not what this narrows.
  it('still comments on a later line of a nested run', () => {
    expect(carveToHtml('/a\n%% b/\n')).toBe('<p>/a</p>')
  })

  it('still comments on the first line of a line block', () => {
    expect(carveToHtml('::: |\n%% b\n:::\n').replace(/\n\s*/g, '')).toBe(
      '<div class="line-block"><p></p></div>',
    )
  })
})

describe('the heading keeps the separator its own strip spells', () => {
  const norm = (html: string) => html.replace(/ id="[^"]*"/g, '')

  it('drops a comment behind a tab', () => {
    expect(norm(carveToHtml('# x\t%% b\n'))).toBe('<section>\n  <h1>x</h1>\n</section>')
  })

  it('drops one whose text begins with it', () => {
    expect(norm(carveToHtml('# %% b\n'))).toBe('<section>\n  <h1></h1>\n</section>')
  })

  it('drops one behind a tab inside a run on its line', () => {
    expect(norm(carveToHtml('# /a\t%% b/\n'))).toBe('<section>\n  <h1>/a</h1>\n</section>')
  })

  it('trims the whole whitespace run in front of the separator', () => {
    expect(norm(carveToHtml('# x  %% b\n'))).toBe('<section>\n  <h1>x</h1>\n</section>')
  })

  // The strip needs `^` or a space or a tab in front of `%%`, so a delimiter in
  // front of it leaves the run to the ordinary inline rule.
  it('leaves a run that opens with it alone', () => {
    expect(norm(carveToHtml('# /%% b/\n'))).toBe('<section>\n  <h1><em>%% b</em></h1>\n</section>')
  })
})
