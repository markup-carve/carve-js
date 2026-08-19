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
// THE EXTENSION-AWARE ANSWER (#1231).
//
// The definition pre-pass probes the block layer with the caller's matchers, so
// an unrelated matcher cannot disable the lazy guard. A matcher that consumes
// the preceding line still changes the answer: there is then no open paragraph.
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

  it('leaves a definition on a lazy marker line as text', () => {
    expect(carveToHtml('para\n* [d]: u\n\n[go][d]\n')).toContain('[go][d]')
    expect(carveToHtml('para\n* [d]: u\n\n[go][d]\n', { extensions: [claiming] })).toContain('[go][d]')
  })

  it('collects where the matcher consumed the line above', () => {
    // Collecting is the CORRECT answer here, and only the matcher knows it: it
    // consumes `@@@ x`, so no paragraph is open and the marker below opens a
    // real item. This is the row that makes the probe worth its cost - an
    // enumeration cannot see an extension's syntax, and guessing "suppress"
    // would lose the definition.
    const html = carveToHtml('@@@ x\n- [d]: u\n\n[go][d]\n', { extensions: [claiming] })
    expect(html).toContain('<a href="u">go</a>')
    expect(html).not.toContain('[d]: u')
  })

  it('does not recurse when the matcher is registered', () => {
    let calls = 0
    const counting: CarveExtension = {
      name: 'counting',
      matchBlock() {
        calls++
        if (calls > 100) throw new Error('recursive lazy probe')
        return null
      },
    }
    expect(carveToHtml('para\n- [d]: u\n\n[go][d]\n', { extensions: [counting] })).toContain('[go][d]')
    expect(calls).toBeLessThan(100)
  })

  it('collects after the byte budget is exhausted', () => {
    const inert: CarveExtension = { name: 'inert', matchBlock: () => null }
    const lines = ['x'.repeat(5000)]
    for (let i = 0; i < 20; i++) lines.push(`- [d${i}]: /${i}`)
    lines.push('', '[go][d19]')
    expect(carveToHtml(lines.join('\n'), { extensions: [inert] })).toContain('<a href="/19">go</a>')
  })
})
