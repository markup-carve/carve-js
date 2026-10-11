import { describe, expect, it } from 'vitest'
import {
  carveToHtml,
  carveToHtmlWithReport,
  renderMarkdown,
  htmlToCarve,
  renderHtml,
  parse,
  resolve,
} from '../src/index.js'

/*
 * PART 10 §13 to §13c, the HTML half of markup-carve/carve#2894.
 *
 * Each expectation on a carrier's BYTES was measured against carve-php's
 * `HtmlRenderer::setRoundTripMode(true)` on the same source, at carve-php main
 * 150dd1c89, with its `data-djot-` prefix normalized to the ruled
 * `data-carve-` one (markup-carve/carve#2902 ruling 0 renames it; no carve-php
 * branch carries the rename yet). The divergences are deliberate and each one
 * says why where it is asserted.
 */

const rt = (src: string): string => carveToHtml(src, { roundtrip: true })

describe('roundtrip export is off by default', () => {
  it.each([
    '* a\n',
    '1) a\n',
    '***\n',
    '{#ex}\n# C\n',
    '[r]: /u\n\n[t][r]\n',
    '<https://e.com>\n',
    'x[^f]\n\n[^f]: note\n',
    'y^[inline]\n',
    '\\* esc\n',
    '`<b>x</b>`{=html}\n',
    '``` php\nx\n```\n',
    '*[HTML]: HyperText Markup Language\n\nHTML\n',
  ])('writes no carrier for %j', (src) => {
    expect(carveToHtml(src)).not.toMatch(/data-carve-|data-djot-|data-marker|data-char/)
  })

  it('leaves the default bytes of a carrier-bearing document untouched', () => {
    // §13 says enabling the option neither removes nor reorders an attribute
    // §1 to §12 write, so every default byte has to survive inside the
    // roundtrip output.
    const src = '{.c #i}\n1) a\n'
    expect(carveToHtml(src)).toBe('<ol data-delim=")" class="c" id="i">\n  <li>a</li>\n</ol>')
    expect(rt(src)).toBe('<ol data-delim=")" data-marker=")" class="c" id="i">\n  <li>a</li>\n</ol>')
  })

  it('keeps the task-list hooks of carve#2887 without the option', () => {
    const html = carveToHtml('- [ ] a\n- [x] b\n')
    expect(html).toContain('class="task-list"')
    expect(html).toContain('data-task-state="x"')
    expect(html).not.toMatch(/data-carve-|data-marker/)
  })
})

describe('the twelve carriers', () => {
  it('data-marker: the authored bullet, only where it is not the default', () => {
    expect(rt('* a\n')).toBe('<ul data-marker="*">\n  <li>a</li>\n</ul>')
    expect(rt('- a\n')).toBe('<ul>\n  <li>a</li>\n</ul>')
  })

  it('data-marker: an ordered list carries its delimiter, not `.`', () => {
    expect(rt('1) a\n')).toBe('<ol data-delim=")" data-marker=")">\n  <li>a</li>\n</ol>')
    expect(rt('1. a\n')).toBe('<ol>\n  <li>a</li>\n</ol>')
  })

  it('data-marker: §12 N2 keeps it on the list, so a nested list derives its own', () => {
    expect(rt('* a\n\n  - b\n')).toBe(
      '<ul data-marker="*">\n  <li>a\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('data-char: the authored break character, only where it is not `-`', () => {
    expect(rt('***\n')).toBe('<hr data-char="*">')
    expect(rt('___\n')).toBe('<hr data-char="_">')
    expect(rt('---\n')).toBe('<hr>')
  })

  it('data-char leads the authored attributes, where carve-php trails them', () => {
    // A DELIBERATE BYTE DIVERGENCE. carve-php emits
    // `<hr class="c" id="i" data-char="*">`; #2902 question 1 measured that its
    // carrier precedence is inconsistent per carrier - `data-marker` already
    // leads - and §1 puts a structural attribute ahead of the authored ones.
    // One rule for all twelve beats mirroring the inconsistency.
    expect(rt('{.c #i}\n***\n')).toBe('<hr data-char="*" class="c" id="i">')
  })

  it('data-carve-explicit-id: presence says the id was authored', () => {
    expect(rt('{#ex}\n# C\n')).toBe('<section id="ex" data-carve-explicit-id="1">\n  <h1>C</h1>\n</section>')
    expect(rt('# C\n')).toBe('<section id="C">\n  <h1>C</h1>\n</section>')
  })

  it('data-carve-explicit-id rides the element that carries the id', () => {
    // §13a: the `<section>` where PART 9 §13 wraps one, the heading where it
    // does not.
    expect(rt('::: note\n{#ex}\n# C\n:::\n')).toContain('<h1 id="ex" data-carve-explicit-id="1">C</h1>')
    expect(renderHtml(resolve(parse('{#ex}\n# C\n')), { roundtrip: true, sections: false }))
      .toBe('<h1 id="ex" data-carve-explicit-id="1">C</h1>')
  })

  it('data-carve-ref: the label a link or an image resolved by', () => {
    expect(rt('[r]: /u\n\n[t][r]\n')).toBe('<p><a href="/u" data-carve-ref="r">t</a></p>')
    expect(rt('[r]: /u\n\n![i][r]\n')).toBe('<img src="/u" alt="i" data-carve-ref="r">')
    expect(rt('[r]: /u\n\n[r][]\n')).toBe('<p><a href="/u" data-carve-ref="r">r</a></p>')
    expect(rt('[t](/u)\n')).toBe('<p><a href="/u">t</a></p>')
  })

  it('data-carve-autolink: presence says the link was authored as one', () => {
    expect(rt('<https://e.com>\n')).toBe('<p><a href="https://e.com" data-carve-autolink="1">https://e.com</a></p>')
    expect(rt('<a@b.com>\n')).toBe('<p><a href="mailto:a@b.com" data-carve-autolink="1">a@b.com</a></p>')
    expect(rt('[https://e.com](https://e.com)\n')).toBe('<p><a href="https://e.com">https://e.com</a></p>')
  })

  it('data-carve-footnote-label rides the reference AND the endnote item', () => {
    const html = rt('x[^lbl]\n\n[^lbl]: note\n')
    expect(html).toContain('role="doc-noteref" data-carve-footnote-label="lbl"')
    expect(html).toContain('<li id="fn1" data-carve-footnote-label="lbl">')
  })

  it('data-carve-inline-footnote: the endnote came from an inline note', () => {
    const html = rt('y^[inline]\n')
    expect(html).toContain('<li id="fn1" data-carve-inline-footnote="1">')
    // An inline note HAS no label, so the two endnote carriers never coincide.
    expect(html).not.toContain('data-carve-footnote-label')
  })

  it('data-carve-raw: the format, with the span holding the content', () => {
    expect(rt('`<b>x</b>`{=html}\n')).toBe('<p><span data-carve-raw="html"><b>x</b></span></p>')
    expect(rt('`\\x`{=tex}\n')).toBe('<p><span data-carve-raw="tex">\\x</span></p>')
  })

  it('data-carve-raw still reports a format this target drops', () => {
    // markup-carve/carve#2902 ruling 7: roundtrip mode was the ONE mode that
    // lost a raw block silently, because it suppressed the diagnostic. The
    // carrier preserves the bytes; the document still does not render what the
    // author asked for, so the loss is reported either way.
    const report = carveToHtmlWithReport('`\\x`{=tex}\n', { roundtrip: true })
    expect(report.losses.map((loss) => loss.code)).toEqual(['raw-format-dropped'])
    expect(report.value).toContain('data-carve-raw="tex"')
  })

  it('data-carve-escaped: ONE escape per element', () => {
    // Ruling 4: a multi-character value imported back as `\a\b\c`, which is not
    // valid Carve, so a run of escapes is a run of spans.
    expect(rt('\\*\\_\\~\n')).toBe(
      '<p><span data-carve-escaped>*</span><span data-carve-escaped>_</span><span data-carve-escaped>~</span></p>',
    )
  })

  it('data-carve-src: the code block’s Carve source on the <pre>', () => {
    expect(rt('``` php\n$x = 1;\n```\n')).toBe(
      '<pre data-carve-src="```php\n$x = 1;\n```\n"><code class="language-php">$x = 1;\n</code></pre>',
    )
  })

  it('data-carve-src widens the fence past a payload that holds one', () => {
    expect(rt('```` txt\n```\n````\n')).toContain('data-carve-src="````txt\n```\n````\n"')
  })

  it('data-carve-src writes the canonical no-space info string', () => {
    // A DELIBERATE BYTE DIVERGENCE. carve-php reconstructs ``` php with a
    // space; PART 9's `fenced_code_block` calls the no-space form canonical and
    // the one the converters emit, and this value is written by carve-js's own
    // canonical writer rather than by a second spelling of it. Both re-parse to
    // the same tree, so the recovered distinction is identical.
    expect(rt('``` php [Lbl]\nx\n```\n')).toContain('data-carve-src="```php [Lbl]\nx\n```\n"')
  })

  it('data-carve-abbreviations: the definitions, one per line, at document end', () => {
    expect(rt('*[HTML]: HyperText Markup Language\n\nHTML rocks\n')).toBe(
      '<p><abbr title="HyperText Markup Language">HTML</abbr> rocks</p>\n'
      + '<template data-carve-abbreviations>*[HTML]: HyperText Markup Language</template>',
    )
  })

  it('data-carve-abbreviations sits before the endnotes, as carve-php places it', () => {
    const html = rt('*[HTML]: HyperText Markup Language\n\nHTML x[^f]\n\n[^f]: note\n')
    expect(html.indexOf('<template')).toBeGreaterThan(-1)
    expect(html.indexOf('<template')).toBeLessThan(html.indexOf('role="doc-endnotes"'))
  })

  it('data-carve-col-widths carries the authored separator widths', () => {
    // The carrier the inventory reserved before anything wrote it. It is
    // written now because `table.separatorWidths` exists to restore it
    // (markup-carve/carve#2894, PART 11 §6h [CARVE-P11-066]): the field
    // answers all three of the measured causes at once - the wire field set,
    // the closed reader schema, and the writer reproducing the row so a
    // "parses to the same tree" comparison sees no new field.
    expect(rt('| a | bb |\n|:-----|---:|\n| 1 | 2 |\n')).toContain(
      '<table data-carve-col-widths="5,3">',
    )
  })

  it('writes no carrier for a table the author gave no separator row', () => {
    // PRESENCE is the distinction. `|=` header cells and a separator row parse
    // to the same rows and alignments, so the attribute's absence is what says
    // which one was written.
    expect(rt('|= a |= bb |\n| 1 | 2 |\n')).not.toContain('col-widths')
  })

  it('round-trips the separator row byte-identically', () => {
    // Measured before this change: the same source came back as
    // `|=< a |=> b |\n| 1 | 2 |\n`.
    const src = '| a | b |\n|:-----|---:|\n| 1 | 2 |\n'
    expect(htmlToCarve(rt(src)).value).toBe(src)
  })

  it('still comes back as the |= form with the option OFF', () => {
    const src = '| a | b |\n|:-----|---:|\n| 1 | 2 |\n'
    expect(htmlToCarve(carveToHtml(src)).value).toBe('|=< a |=> b |\n| 1 | 2 |\n')
  })

  it('imports the deprecated spelling of the carrier too', () => {
    const html = '<table data-djot-col-widths="4,2">\n<tr><th>a</th><th>b</th></tr>\n'
      + '<tr><td>1</td><td>2</td></tr>\n</table>'
    expect(htmlToCarve(html).value).toBe('| a | b |\n|----|--|\n| 1 | 2 |\n')
  })

  it('refuses the WHOLE carrier where an entry exceeds the bound', () => {
    // [CARVE-P10-016]. The widths arrive in an attribute read off untrusted
    // HTML and the writer spells one `-` per unit, so the bound is what stops
    // six characters of attribute buying a megabyte of separator row. REFUSED,
    // not clamped: a clamp keeps a separator row whose widths nobody wrote.
    const at = (value: string): string =>
      `<table data-carve-col-widths="${value}">\n<tr><th>a</th></tr>\n<tr><td>1</td></tr>\n</table>`
    expect(htmlToCarve(at('1001')).value).toBe('|= a |\n| 1 |\n')
    // One bad entry refuses the whole carrier, not just its own cell.
    expect(htmlToCarve(at('3,1001')).value).toBe('|= a |\n| 1 |\n')
    // The bound itself is carried.
    expect(htmlToCarve(at('1000')).value).toBe(`| a |\n|${'-'.repeat(1000)}|\n| 1 |\n`)
  })

  it('writes no carrier where the FIELD holds an entry above the bound', () => {
    // The other side of the same rule: a carrier a conforming reader will
    // refuse is a round-trip promise the writer cannot keep. The field itself
    // has no upper bound - a parse records what the author typed - so the
    // table still renders and still carries the widths in the tree.
    const table = parse(`| a |\n|${'-'.repeat(1001)}|\n| 1 |\n`).children[0]
    if (table?.type !== 'table') throw new Error('no table')
    expect(table.separatorWidths).toEqual([1001])
    const html = renderHtml({ type: 'document', children: [table] }, { roundtrip: true })
    expect(html).not.toContain('col-widths')
    expect(html).toContain('<table>')
    expect(rt(`| a |\n|${'-'.repeat(1000)}|\n| 1 |\n`)).toContain('col-widths')
  })

  it('refuses the WHOLE carrier where an entry is not a run of digits', () => {
    // The table still imports, in the `|=` header form, which is what the
    // field's absence means. One bad entry refuses the whole attribute rather
    // than keeping the entries around it: a partial read would put a separator
    // row on the page whose widths nobody wrote.
    for (const value of ['', '0', '2,x', '-1', '1.5', '3,', '+3', ' ', ' 3', '3 ', '2, 3']) {
      const html = `<table data-carve-col-widths="${value}">\n<tr><th>a</th></tr>\n<tr><td>1</td></tr>\n</table>`
      const result = htmlToCarve(html)
      expect(result.value, value).toBe('|= a |\n| 1 |\n')
      expect(result.report.diagnostics.map(item => item.code), value).toContain('attribute-dropped')
    }
  })

})

describe('an authored attribute colliding with a carrier', () => {
  it.each([
    ['{data-marker=Z}\n* a\n', 'data-marker', '<ul data-marker="*">\n  <li>a</li>\n</ul>'],
    ['{data-char=Z}\n***\n', 'data-char', '<hr data-char="*">'],
  ])('drops the authored %s and reports it', (src, name, expected) => {
    // Ruling 1. carve-php emits BOTH today, which is invalid HTML.
    const report = carveToHtmlWithReport(src, { roundtrip: true })
    expect(report.value).toBe(expected)
    expect(report.value.match(new RegExp(name, 'g'))).toHaveLength(1)
    expect(report.losses).toEqual([
      expect.objectContaining({ code: 'carrier-attribute-dropped', target: 'html', attribute: name }),
    ])
  })

  it('drops an authored data-carve-ref under the canonical spelling', () => {
    const report = carveToHtmlWithReport('[r]: /u\n\n[t][r]{data-carve-ref=Z}\n', { roundtrip: true })
    expect(report.value).toBe('<p><a href="/u" data-carve-ref="r">t</a></p>')
    expect(report.losses.map((loss) => loss.code)).toEqual(['carrier-attribute-dropped'])
  })

  it.each([
    ['{#x data-carve-explicit-id=0}\n# H\n', '<section id="x" data-carve-explicit-id="1">\n  <h1>H</h1>\n</section>'],
    ['::: note\n{#x data-carve-explicit-id=0}\n# H\n:::\n',
      '<aside class="admonition note" aria-label="Note">\n  <h1 id="x" data-carve-explicit-id="1">H</h1>\n</aside>'],
  ])('drops an authored explicit-id carrier, wrapped or not', (src, expected) => {
    // The carrier rides the `<section>` while the authored attribute stays on
    // the `<h*>`, so the drop has to happen on the heading's attributes under
    // both placements.
    const report = carveToHtmlWithReport(src, { roundtrip: true })
    expect(report.value).toBe(expected)
    expect(report.value.match(/data-carve-explicit-id/g)).toHaveLength(1)
    expect(report.losses.map((loss) => loss.code)).toEqual(['carrier-attribute-dropped'])
  })

  it('names the attribute in the diagnostic', () => {
    const report = carveToHtmlWithReport('{data-char=Z}\n***\n', { roundtrip: true })
    expect(report.losses[0]!.message).toContain('data-char')
  })

  it('leaves the authored attribute alone where the carrier is not written', () => {
    // No collision without a carrier: a `-` break writes no `data-char`, so the
    // authored one is ordinary content and the default bytes are unchanged.
    const report = carveToHtmlWithReport('{data-char=Z}\n---\n', { roundtrip: true })
    expect(report.value).toBe('<hr data-char="Z">')
    expect(report.losses).toEqual([])
  })

  it('leaves the authored attribute alone with the option OFF', () => {
    const report = carveToHtmlWithReport('{data-marker=Z}\n* a\n')
    expect(report.value).toBe('<ul data-marker="Z">\n  <li>a</li>\n</ul>')
    expect(report.losses).toEqual([])
  })
})

describe('export does not select an import mode (§13b)', () => {
  it('leaves a denied destination denied', () => {
    const report = carveToHtmlWithReport('[x](javascript:one)\n', { roundtrip: true })
    expect(report.value).toBe('<p><a href="">x</a></p>')
    expect(report.losses.map((loss) => loss.code)).toContain('destination-denied')
  })

  it('leaves a denied destination denied behind a reference carrier too', () => {
    const html = rt('[r]: javascript:one\n\n[t][r]\n')
    expect(html).toBe('<p><a href="" data-carve-ref="r">t</a></p>')
  })

  it('keeps raw HTML escaped when the renderer was told not to trust it', () => {
    const html = carveToHtml('`<b>x</b>`{=html}\n', { roundtrip: true, allowRawHtml: false })
    expect(html).toBe('<p><span data-carve-raw="html">&lt;b&gt;x&lt;/b&gt;</span></p>')
  })

  it('safe import consumes the inventory and writes no reserved name back out', () => {
    // Ruling 5. Measured before this change: `<hr data-char="_">` came back as
    // `{data-char=_}` plus `---`, and a reference link as
    // `[t](/u){data-carve-ref=r}`.
    for (const src of [
      '* a\n* b\n',
      '1) a\n',
      '***\n',
      '{#ex}\n# C\n',
      '[r]: /u\n\n[t][r]\n',
      '<https://e.com>\n',
      'x[^lbl]\n\n[^lbl]: note\n',
      'y^[inline]\n',
      '\\* esc\n',
      '`<b>x</b>`{=html}\n',
      '``` php\n$x = 1;\n```\n',
      '*[HTML]: HyperText Markup Language\n\nHTML rocks\n',
      '| a | bb |\n|:-----|---:|\n| 1 | 2 |\n',
    ]) {
      const back = htmlToCarve(rt(src)).value
      expect(back, src).not.toMatch(/data-carve-|data-djot-|data-marker|data-char/)
    }
  })

  it('refuses both spellings of a carrier, in safe mode as in roundtrip', () => {
    for (const mode of ['safe', 'roundtrip'] as const) {
      for (const name of ['data-carve-ref', 'data-djot-ref', 'data-marker', 'data-char']) {
        const back = htmlToCarve(`<p><a href="/u" ${name}="r">t</a></p>`, { mode }).value
        expect(back, `${mode} ${name}`).not.toContain(name)
      }
    }
  })
})

describe('§13c: an alias never turns preservation off', () => {
  const container = '::: note\ntext\n:::\n'
  const carried = (opts: { carryMarkers?: boolean; roundtrip?: boolean }): boolean =>
    renderMarkdown(parse(container), opts).includes('<!--')

  it.each([
    [{}, false],
    [{ carryMarkers: true }, true],
    [{ roundtrip: true }, true],
    [{ carryMarkers: true, roundtrip: true }, true],
    [{ carryMarkers: false, roundtrip: true }, true],
    [{ carryMarkers: true, roundtrip: false }, true],
    [{ carryMarkers: false, roundtrip: false }, false],
  ])('%j carries containers: %s', (opts, expected) => {
    expect(carried(opts)).toBe(expected)
  })

  it('does not redefine carryMarkers as an HTML option', () => {
    expect(carveToHtml('* a\n', { carryMarkers: true } as Record<string, unknown>))
      .toBe('<ul>\n  <li>a</li>\n</ul>')
  })

  it('carries containers and no more on the Markdown target', () => {
    // §13: "A Markdown export carries containers and no more, and is not a
    // claim to preserve what §13a lists."
    const md = renderMarkdown(parse('***\n'), { roundtrip: true })
    expect(md).not.toContain('data-char')
  })
})
