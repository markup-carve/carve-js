import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import type { CarveExtension } from '../src/extension.js'

describe('a link definition behind a lazy list marker', () => {
  const unresolved = '<p>[go][d]</p>'

  it.each([
    ['document prose', 'para\n* [d]: u\n\n[go][d]\n', '<p>para\n* [d]: u</p>'],
    ['quoted prose', '> r\n> - [d]: u\n\n[go][d]\n', '<blockquote><p>r\n- [d]: u</p></blockquote>'],
    ['prose in a div', '::: n\nr\n- [d]: u\n:::\n\n[go][d]\n', '<div class="n">\n  <p>r\n- [d]: u</p>\n</div>'],
    [
      'a second quoted marker',
      '> r\n> - a\n> - [d]: u\n\n[go][d]\n',
      '<blockquote><p>r\n- a\n- [d]: u</p></blockquote>',
    ],
    ['a quote behind a lazy list marker', 'para\n- > [d]: u\n\n[go][d]\n', '<p>para\n- &gt; [d]: u</p>'],
    [
      'a nested quote behind a lazy list marker',
      '> para\n> - > [d]: u\n\n[go][d]\n',
      '<blockquote><p>para\n- &gt; [d]: u</p></blockquote>',
    ],
  ])('keeps the definition-shaped line as %s', (_name, source, paragraph) => {
    expect(carveToHtml(source)).toBe(`${paragraph}\n${unresolved}`)
  })

  it.each([
    ['item continuation prose', '- a\n  more\n* [d]: u\n\n[go][d]\n'],
    ['lazy item prose', '- a\nlazy\n* [d]: u\n\n[go][d]\n'],
  ])('still collects after %s', (_name, source) => {
    expect(carveToHtml(source)).toContain('<a href="u">go</a>')
  })

  it('still collects when a fresh quote interrupts top-level prose', () => {
    expect(carveToHtml('para\n> - [d]: u\n\n[go][d]\n')).toContain('<a href="u">go</a>')
  })

  // The FOOTNOTE kind, which grammar PART 9R R1a governs on its own - the link
  // kind is the one that was broken here, so these rows pin the half that was
  // right by construction (this engine collects footnotes structurally, so a
  // lazy line never reaches the collector) and would otherwise change silently.
  it.each([
    ['a bare lazy marker', 'para\n- [^f]: t\n\nuse[^f]\n', '<p>para\n- [^f]: t</p>'],
    [
      'a quoted lazy marker',
      '> r\n> - [^f]: t\n\nuse[^f]\n',
      '<blockquote><p>r\n- [^f]: t</p></blockquote>',
    ],
    [
      'a marker in a div',
      '::: n\nr\n- [^f]: t\n:::\n\nuse[^f]\n',
      '<div class="n">\n  <p>r\n- [^f]: t</p>\n</div>',
    ],
    ['a quote behind a lazy marker', 'para\n- > [^f]: t\n\nuse[^f]\n', '<p>para\n- &gt; [^f]: t</p>'],
  ])('keeps a footnote definition as text after %s', (_name, source, paragraph) => {
    const html = carveToHtml(source)
    expect(html).toBe(`${paragraph}\n<p>use[^f]</p>`)
    expect(html).not.toContain('doc-endnotes')
  })

  it('still collects a footnote where no paragraph is open', () => {
    // The control for the rows above: a heading leaves nothing open, so the
    // marker opens a real item and the definition IS metadata.
    const html = carveToHtml('# h\n- [^f]: t\n\nuse[^f]\n')
    expect(html).toContain('role="doc-noteref"')
    expect(html).toContain('role="doc-endnotes"')
  })

  // The ABBREVIATION kind is decided before R1a reaches it: PART 12 section 7
  // restricts the definition to a direct child of the document, and at the
  // document level it INTERRUPTS an open paragraph rather than folding into one.
  // Both rows below therefore pin section 7 and section 10, not R1a - labelled so
  // nobody reads them as coverage of this clause.
  it('expands an abbreviation definition that interrupts a paragraph', () => {
    expect(carveToHtml('para\n*[AB]: x\n\nAB\n')).toBe('<p>para</p>\n<p><abbr title="x">AB</abbr></p>')
  })

  it('leaves an abbreviation definition behind a marker as text', () => {
    const html = carveToHtml('para\n- *[AB]: x\n\nAB\n')
    expect(html).toBe('<p>para\n- *[AB]: x</p>\n<p>AB</p>')
    expect(html).not.toContain('<abbr')
  })
})

// ---------------------------------------------------------------------------
// THE DECLARED IMPRECISION, pinned so it cannot drift quietly (#1231).
//
// `collectLinkDefs` switches its lazy guard off whenever ANY block matcher is
// registered, because the pre-pass cannot know which lines an extension claims.
// Grammar PART 9R R1a permits that: an engine which cannot answer MUST fail
// toward COLLECTING rather than delete the author's line, and this is that
// direction. It is imprecise rather than wrong, and the rows below say exactly
// how far the imprecision reaches, so fixing #1231 flips them loudly instead of
// leaving a silent behavior change.
// ---------------------------------------------------------------------------

describe('the lazy guard with a block matcher registered', () => {
  const claiming: CarveExtension = {
    name: 'claiming',
    matchBlock(lines, start) {
      const line = lines[start]
      if (!line || !line.startsWith('@@@ ')) return null

      return {
        node: { type: 'paragraph', children: [{ type: 'text', value: line.slice(4) }] },
        linesConsumed: 1,
      }
    },
  }

  it('collects from a lazy marker line - the fail-open direction R1a requires', () => {
    // Without the extension this resolves nothing. With ANY matcher registered
    // the guard is off, so the definition is collected even though the line
    // renders as paragraph text. carve-rs and carve-php answer this precisely by
    // probing the block parser, which R1a explicitly allows them to do.
    expect(carveToHtml('para\n* [d]: u\n\n[go][d]\n')).toContain('[go][d]')
    expect(carveToHtml('para\n* [d]: u\n\n[go][d]\n', { extensions: [claiming] })).toContain(
      '<a href="u">go</a>',
    )
  })

  it('gets the extension-consumed line right, which is why the fallback is collect', () => {
    // Here collecting is the CORRECT answer: the matcher consumes `@@@ x`, so no
    // paragraph is open and the marker below opens a real item. An engine that
    // guessed "suppress" instead would lose this definition.
    const html = carveToHtml('@@@ x\n- [d]: u\n\n[go][d]\n', { extensions: [claiming] })
    expect(html).toContain('<a href="u">go</a>')
    expect(html).not.toContain('[d]: u')
  })
})
