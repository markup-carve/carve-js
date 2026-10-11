import { describe, expect, it } from 'vitest'
import {
  carveToHtml,
  htmlToAst,
  htmlToCarve,
  parse,
} from '../src/index.js'
import type { Document } from '../src/ast.js'

/*
 * PART 10 §13 to §13b, the IMPORT half of markup-carve/carve#2894.
 *
 * carve-js#2721 wrote the carriers and stopped the importer handing a reserved
 * name back as authored content; it could not assert what the carriers HOLD,
 * because nothing read them. §13's guarantee is "recovery of the named
 * distinctions, not byte-identical source", so that is what is asserted here:
 * Carve to export to import, then the distinctions and the rendering.
 */

const rt = (src: string): string => carveToHtml(src, { roundtrip: true })
const back = (src: string): string => htmlToCarve(rt(src)).value
const imported = (src: string): Document => htmlToAst(rt(src)).value

/** Every node, in document order, definitions last. */
function walk(doc: Document): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    if (typeof node !== 'object' || node === null) return
    const record = node as Record<string, unknown>
    if (typeof record.type === 'string') out.push(record)
    for (const key of ['children', 'items', 'inline', 'rows', 'cells', 'caption', 'terms', 'definitions']) {
      if (key in record) visit(record[key])
    }
  }
  visit(doc.children)
  for (const blocks of Object.values(doc.footnoteDefs ?? {})) visit(blocks)
  return out
}

/**
 * The distinctions §13 names, in document order.
 *
 * Deliberately NOT a deep tree comparison: §13 guarantees these facts and not
 * the bytes around them, and a `pos` or a generated number differing between
 * a parse and an import would drown the comparison that matters.
 */
function distinctions(doc: Document): string[] {
  return walk(doc).flatMap((node) => {
    const attrs = node.attrs as { id?: string } | undefined
    switch (node.type) {
      case 'list':
        return [`list ${node.ordered ? `ol ${String(node.delim ?? '.')}` : `ul ${String(node.bulletChar ?? '-')}`}`]
      case 'list_item':
        return node.checked === undefined
          ? []
          : [`task ${String(node.taskState ?? (node.checked ? 'x' : ' '))}`]
      case 'thematic_break':
        return [`break ${String(node.marker ?? '-')}`]
      case 'heading':
        return [`heading id=${String(attrs?.id ?? '-')}`]
      case 'link':
      case 'image':
        return [`${node.type} ref=${String(node.ref ?? '-')} raw=${String(node.rawRef ?? '-')}`]
      case 'autolink':
        return [`autolink ${String(node.href)}`]
      case 'footnote_ref':
        return [`footnote_ref ${String(node.label)}`]
      case 'inline_footnote':
        return ['inline_footnote']
      case 'raw_inline':
        return [`raw ${String(node.format)}`]
      case 'escaped_text':
        return [`escaped ${String(node.value)}`]
      case 'abbreviation_def':
        return [`abbr ${String(node.abbr)}`]
      default:
        return []
    }
  })
}

/*
 * The thirteen carrier-bearing documents the export test already uses, plus
 * the shapes §2894 names that it did not reach: nested containers, all seven
 * task states, and every reference form.
 */
const DOCUMENTS: Array<[string, string]> = [
  ['a bullet list on the authored marker', '* a\n* b\n'],
  ['the default bullet', '- a\n'],
  ['an ordered list on the authored delimiter', '1) a\n'],
  ['the default ordered delimiter', '1. a\n'],
  ['a thematic break on each character', '***\n\n___\n\n---\n'],
  ['an explicit identifier', '{#ex}\n# C\n'],
  ['a generated identifier', '# C\n'],
  ['a full reference link', '[r]: /u\n\n[t][r]\n'],
  ['a reference image', '[r]: /u\n\n![i][r]\n'],
  ['two links on one label', '[r]: /u\n\n[a][r] and [b][r]\n'],
  ['an inline link beside a reference one', '[r]: /u\n\n[t][r] and [p](/q)\n'],
  ['a URI autolink', '<https://e.com>\n'],
  ['an email autolink', '<a@b.com>\n'],
  ['a labelled footnote', 'x[^lbl]\n\n[^lbl]: note\n'],
  ['an inline footnote', 'y^[inline]\n'],
  ['an escape', '\\* esc\n'],
  ['a run of escapes', '\\*\\_\\~\n'],
  ['a raw inline of a foreign format', '`\\x`{=tex}\n'],
  ['a fenced code block', '``` php\n$x = 1;\n```\n'],
  ['abbreviation definitions', '*[HTML]: HyperText Markup Language\n\nHTML rocks\n'],
  ['a table', '| a | bb |\n|:-----|---:|\n| 1 | 2 |\n'],
  ['all seven task states', '- [ ] a\n- [x] b\n- [X] c\n- [-] d\n- [_] e\n- [>] f\n- [?] g\n'],
  ['a nested container', '::: note\n* a\n\n  ***\n:::\n'],
  ['a container holding every carrier', '::: note\n{#in}\n# H\n\n* a\n\n***\n\n<https://e.com>\n:::\n'],
]

describe('Carve to export to import keeps the §13 distinctions', () => {
  it.each(DOCUMENTS)('%s', (_name, src) => {
    // Against the PARSE rather than the resolution: `resolve` writes the
    // generated heading id into `attrs.id`, and whether an id was AUTHORED is
    // exactly the distinction `data-carve-explicit-id` carries, so resolving
    // the oracle would erase the fact under test.
    expect(distinctions(imported(src))).toEqual(distinctions(parse(src)))
  })

  it.each(DOCUMENTS)('%s renders the same HTML again', (_name, src) => {
    // The second half of #2894's criterion: the distinctions AND the resulting
    // rendering. A reconstruction that restored a field but moved the content
    // would pass the comparison above and fail here.
    expect(carveToHtml(back(src))).toBe(carveToHtml(src))
  })

  it.each(DOCUMENTS)('%s writes no reserved name back out', (_name, src) => {
    expect(back(src)).not.toMatch(/data-carve-|data-djot-|data-marker|data-char/)
  })

  it('recovers a collapsed reference as the full form, which §13 allows', () => {
    // THE ONE DOCUMENTED NON-RECOVERY. `[r][]` and `[r][r]` render the same
    // bytes, carrier included, so the spelling is not in the HTML to recover.
    // §13 guarantees the DISTINCTION - the label the link resolved by - and
    // not the source, and `rawRef` is where the spelling lives.
    expect(back('[r]: /u\n\n[r][]\n')).toBe('[r][r]\n\n[r]: /u\n')
    expect(carveToHtml(back('[r]: /u\n\n[r][]\n'))).toBe(carveToHtml('[r]: /u\n\n[r][]\n'))
  })
})

describe('each carrier reconstructs its own node', () => {
  it('data-marker restores the authored bullet and delimiter', () => {
    expect(back('* a\n')).toBe('* a\n')
    expect(back('1) a\n')).toBe('1) a\n')
    // Before this change both came back on the default marker.
    expect(htmlToCarve('<ul data-marker="*"><li>a</li></ul>').value).toBe('* a\n')
  })

  it('data-char restores the break character', () => {
    expect(back('***\n')).toBe('***\n')
    expect(back('___\n')).toBe('___\n')
    expect(back('---\n')).toBe('---\n')
  })

  it('data-carve-explicit-id keeps an authored id and leaves a generated one', () => {
    expect(back('{#ex}\n# C\n')).toBe('{#ex}\n# C\n')
    expect(back('# C\n')).toBe('# C\n')
  })

  it('data-carve-ref restores the label and writes the definition beside it', () => {
    expect(back('[r]: /u\n\n[t][r]\n')).toBe('[t][r]\n\n[r]: /u\n')
    expect(back('[r]: /u\n\n![i][r]\n')).toBe('![i][r]\n\n[r]: /u\n')
  })

  it('data-carve-ref writes ONE definition for a label two links share', () => {
    const source = back('[r]: /u\n\n[a][r] and [b][r]\n')
    expect(source.match(/^\[r\]: \/u$/gm)).toHaveLength(1)
    expect(source).toContain('[a][r]')
    expect(source).toContain('[b][r]')
  })

  it('data-carve-autolink restores the autolink node type', () => {
    expect(back('<https://e.com>\n')).toBe('<https://e.com>\n')
    expect(back('<a@b.com>\n')).toBe('<a@b.com>\n')
    // The control: the same destination written as an inline link stays one.
    expect(back('[https://e.com](https://e.com)\n')).toBe('[https://e.com](https://e.com)\n')
  })

  it('data-carve-footnote-label restores the authored label', () => {
    expect(back('x[^lbl]\n\n[^lbl]: note\n')).toBe('x[^lbl]\n\n[^lbl]: note\n')
    // The reference retains its authored label.
    expect(distinctions(imported('x[^lbl]\n\n[^lbl]: note\n'))).toContain('footnote_ref lbl')
  })

  it('data-carve-inline-footnote restores the inline footnote', () => {
    expect(back('y^[inline]\n')).toBe('y^[inline]\n')
    expect(distinctions(imported('y^[inline]\n'))).toEqual(['inline_footnote'])
  })

  it('data-carve-escaped restores one escaped_text per element', () => {
    expect(back('\\*\\_\\~\n')).toBe('\\*\\_\\~\n')
    expect(distinctions(imported('\\*\\_\\~\n'))).toEqual(['escaped *', 'escaped _', 'escaped ~'])
  })

  it('data-carve-raw restores the format, never a raw HTML inline of the wrong one', () => {
    // The worst measured shape in markup-carve/carve-js#2722: the carrier span
    // was read as raw HTML, so `` `x`{=tex} `` came back as
    // `` `<span data-carve-raw="tex">x</span>`{=html} ``.
    expect(back('`\\x`{=tex}\n')).toBe('`\\x`{=tex}\n')
    expect(distinctions(imported('`\\x`{=tex}\n'))).toEqual(['raw tex'])
  })

  it('rebuilds a raw HTML inline only where the mode trusts the input', () => {
    // §13b, and the one carrier whose answer the mode decides. A raw inline of
    // format `html` is markup every HTML render emits verbatim, so rebuilding
    // one in `safe` would hand the document back what the import just
    // filtered. `roundtrip` already preserves input markup wholesale.
    const html = carveToHtml('`<b>x</b>`{=html}\n', { roundtrip: true })
    expect(html).toBe('<p><span data-carve-raw="html">&lt;b&gt;x&lt;/b&gt;</span></p>')
    expect(htmlToCarve(html, { mode: 'roundtrip' }).value).toBe('`<b>x</b>`{=html}\n')
    expect(carveToHtml(htmlToCarve(html, { mode: 'safe' }).value)).toBe('<p>&lt;b&gt;x&lt;/b&gt;</p>')
  })

  it.each([
    ['as elements', '<p><span data-carve-raw="html"><script>alert(1)</script></span></p>'],
    ['as escaped text', '<p><span data-carve-raw="html">&lt;script&gt;alert(1)&lt;/script&gt;</span></p>'],
    ['under a format the writer would normalize into html',
      '<p><span data-carve-raw="h t m l">&lt;script&gt;alert(1)&lt;/script&gt;</span></p>'],
  ])('never lets a raw carrier smuggle a script past safe mode %s', (_shape, attack) => {
    // Entity-escaped is the SAME payload: a rebuilt `{=html}` raw inline emits
    // it verbatim, so the shape of the span cannot be what decides this.
    const source = htmlToCarve(attack).value
    expect(carveToHtml(source)).not.toContain('<script>')
  })

  it('rebuilds a raw inline of an inert format in every mode', () => {
    for (const mode of ['safe', 'semantic', 'roundtrip'] as const) {
      expect(htmlToCarve('<p><span data-carve-raw="tex">\\x</span></p>', { mode }).value, mode)
        .toBe('`\\x`{=tex}\n')
    }
  })

  it('data-carve-abbreviations restores the definitions and leaves the uses prose', () => {
    expect(back('*[HTML]: HyperText Markup Language\n\nHTML rocks\n'))
      .toBe('*[HTML]: HyperText Markup Language\n\nHTML rocks\n')
    // An `<abbr>` nothing defined is still the authored span.
    expect(htmlToCarve('<p><abbr title="X">c</abbr></p>').value).toBe('[c]{abbr=X}\n')
  })
})

describe('the deprecated data-djot- spelling still reads', () => {
  it.each([
    ['<p><a href="https://e.com" data-djot-autolink="1">https://e.com</a></p>', '<https://e.com>\n'],
    ['<p><span data-djot-raw="tex">\\x</span></p>', '`\\x`{=tex}\n'],
    ['<p><span data-djot-escaped>*</span></p>', '\\*\n'],
    ['<p><a href="/u" data-djot-ref="r">t</a></p>', '[t][r]\n\n[r]: /u\n'],
  ])('reads %j', (html, expected) => {
    expect(htmlToCarve(html).value).toBe(expected)
  })

  it('reads data-char and data-marker under their own single spelling', () => {
    expect(htmlToCarve('<hr data-char="_">').value).toBe('___\n')
    expect(htmlToCarve('<ol data-marker=")"><li>a</li></ol>').value).toBe('1) a\n')
  })
})

describe('a carrier that cannot be honored is not one', () => {
  it.each([
    ['a marker outside the enumeration', '<ul data-marker="Z"><li>a</li></ul>', '- a\n'],
    ['an ordered marker on a bullet list', '<ul data-marker=")"><li>a</li></ul>', '- a\n'],
    ['a break character outside the enumeration', '<hr data-char="Z">', '---\n'],
    ['a malformed reference label', '<p><a href="/u" data-carve-ref="a]b">t</a></p>', '[t](/u)\n'],
    ['an empty reference label', '<p><a href="/u" data-carve-ref="">t</a></p>', '[t](/u)\n'],
    ['a multi-character escape', '<p><span data-carve-escaped>abc</span></p>', 'abc\n'],
    ['a character that spells no escape', '<p><span data-carve-escaped>a</span></p>', 'a\n'],
    ['an empty raw carrier', '<p><span data-carve-raw="tex"></span></p>', '\n'],
    ['an escape carrier holding markup', '<p><span data-carve-escaped><b>*</b></span></p>', '{***}\n'],
    ['an escape carrier with authored attributes', '<p><span data-carve-escaped class="x">*</span></p>', '[*]{.x}\n'],
    ['a raw carrier with authored attributes', '<p><span data-carve-raw="tex" class="x">y</span></p>', '[y]{.x}\n'],
    ['a format the parser would not read', '<p><span data-carve-raw="h t m l">y</span></p>', 'y\n'],
    ['a reference label that spells a footnote', '<p><a href="/u" data-carve-ref="^r">t</a></p>', '[t](/u)\n'],
  ])('%s is dropped, not reconstructed and not written back', (_name, html, expected) => {
    // PART 10 §12's precedent: a value outside the enumeration is not the
    // carrier. Ruling 5 then refuses the name on the way out either way, so an
    // unreadable carrier is reported dropped rather than kept as an attribute.
    const result = htmlToCarve(html)
    expect(result.value).toBe(expected)
    expect(result.value).not.toMatch(/data-carve-|data-djot-|data-marker|data-char/)
  })

  it('reports every carrier it refused, not only the ones on a kept node', () => {
    const rows = htmlToAst('<p><span data-carve-escaped>abc</span></p>').report.diagnostics
    expect(rows.map((row) => row.message).join('\n')).toContain('data-carve-escaped')
  })

  it('rejects a line terminator inside a carried footnote label', () => {
    // The definition pattern is not line-anchored, so its label class admits a
    // newline, and the writer puts the label verbatim into the reference and
    // the definition - which let a carrier carry whole blocks into the source.
    const html = rt('x[^lbl]\n\n[^lbl]: note\n')
      .replace(/data-carve-footnote-label="lbl"/g, 'data-carve-footnote-label="a&#10;&#10;```&#61;html&#10;&lt;script&gt;alert(1)&lt;/script&gt;&#10;```&#10;&#10;b"')
    const source = htmlToCarve(html).value
    expect(source).toBe('x[^1]\n\n[^1]: note\n')
    expect(carveToHtml(source)).not.toContain('<script>')
  })

  it('ends an abbreviation definition at EVERY line terminator', () => {
    // A carriage return inside an expansion is a line ending to the Carve
    // parser, so leaving one in let a definition carry a whole fenced raw
    // block into the generated source.
    const html = '<p>x</p><template data-carve-abbreviations>'
      + '*[X]: hi&#13;```&#61;html&#13;&lt;script&gt;alert(1)&lt;/script&gt;&#13;```</template>'
    const source = htmlToCarve(html).value
    expect(source).toBe('*[X]: hi\n\nx\n')
    expect(carveToHtml(source)).not.toContain('<script>')
  })

  it('charges the abbreviation template against the import limits', () => {
    // Read before the walk, so without an explicit charge its subtree is the
    // one input that reaches a reconstructed node past `maxDepth`.
    expect(() => htmlToAst(
      '<p>x</p><template data-carve-abbreviations><div><div>*[X]: e</div></div></template>',
      { maxDepth: 1 },
    )).toThrow()
  })

  it('reports the unreadable carrier and stays silent on the honored one', () => {
    const dropped = htmlToAst('<hr data-char="Z">').report.diagnostics
    expect(dropped.map((row) => row.message).join('\n')).toContain('data-char')
    const honored = htmlToAst('<hr data-char="_">').report.diagnostics
    expect(honored.map((row) => row.message).join('\n')).not.toContain('data-char')
  })

  it('skips an abbreviation line the parser would not read', () => {
    // A name outside the parser's `[A-Za-z0-9]+`, or a blank expansion, is not
    // a definition: emitting one would put a visible paragraph in the
    // document instead.
    expect(htmlToCarve(
      '<p>x</p><template data-carve-abbreviations>*[X-Y]: e\n*[Z]: ok</template>',
    ).value).toBe('*[Z]: ok\n\nx\n')
  })

  it('reads no abbreviation carrier out of a raw-preserved subtree', () => {
    // §13a places the carrier on a `<template>` at DOCUMENT end. A deeper one
    // sits inside bytes roundtrip mode preserves wholesale, so reading it both
    // left the template in those bytes and defined the abbreviation for the
    // whole document.
    const html = '<figure><template data-carve-abbreviations>*[X]: expanded</template></figure><p>X</p>'
    expect(htmlToCarve(html, { mode: 'roundtrip' }).value).not.toContain('*[X]:')
    expect(carveToHtml(htmlToCarve(html, { mode: 'roundtrip' }).value)).toContain('<p>X</p>')
  })

  it('lets the FIRST abbreviation template define an abbreviation', () => {
    expect(htmlToCarve(
      '<p>x</p><template data-carve-abbreviations>*[X]: first</template>'
      + '<template data-carve-abbreviations>*[X]: second</template>',
    ).value).toBe('*[X]: first\n\nx\n')
  })

  it('refuses a second destination hiding behind a label the document bound', () => {
    // One label is one definition. The second link keeps its own destination
    // inline rather than resolving to the first one's.
    const source = htmlToCarve(
      '<p><a href="/u" data-carve-ref="r">a</a> <a href="/v" data-carve-ref="r">b</a></p>',
    ).value
    expect(source).toContain('[a][r]')
    expect(source).toContain('[b](/v)')
    expect(source.match(/^\[r\]: /gm)).toHaveLength(1)
  })

  it('drops both footnote carriers where one endnote carries contradictory metadata', () => {
    const html = rt('x[^lbl]\n\n[^lbl]: note\n').replace('<li id="fn1"', '<li id="fn1" data-carve-inline-footnote="1"')
    const result = htmlToCarve(html)
    expect(result.value).toBe('x[^1]\n\n[^1]: note\n')
    expect(result.report.diagnostics.map((row) => row.message).join('\n')).toContain('contradict')
  })
})

describe('reconstruction is not a trust decision (§13b)', () => {
  it('rebuilds the carriers in safe mode exactly as in roundtrip', () => {
    for (const [, src] of DOCUMENTS) {
      expect(htmlToCarve(rt(src), { mode: 'safe' }).value, src)
        .toBe(htmlToCarve(rt(src), { mode: 'roundtrip' }).value)
    }
  })

  it('leaves a denied destination denied behind a reference carrier', () => {
    // The carrier names a label, never a destination: nothing routes the value
    // §25 removed back into the document.
    const source = htmlToCarve('<p><a href="javascript:one" data-carve-ref="r">t</a></p>').value
    expect(source).not.toContain('javascript:')
    expect(source).not.toContain('[r]:')
  })

  it('leaves a denied destination denied behind an autolink carrier', () => {
    const source = htmlToCarve('<p><a href="javascript:one" data-carve-autolink="1">x</a></p>').value
    expect(source).not.toContain('javascript:')
    expect(source).not.toContain('<x>')
  })

  it('does not consume a trusted-metadata name it was never given', () => {
    // §13a reserves an ENUMERATION, not a prefix pattern: a name under the
    // prefix that the inventory does not list is the author's attribute here
    // and stays one, rather than being eaten as protocol.
    expect(htmlToCarve('<hr data-carve-invented="1">').value).toBe('{data-carve-invented=1}\n---\n')
    // `data-marker` and `data-char` have no prefixed form at all (ruling 3),
    // so this is an author's attribute and not a second spelling of one.
    expect(htmlToCarve('<ul data-djot-marker="*"><li>a</li></ul>').value).toBe('{data-djot-marker=*}\n- a\n')
  })

  it('rebuilds an autolink only where its text spells its own destination', () => {
    // The writer emits `<text>`, so any other text produces a `<hi>` that
    // re-parses as literal text and loses the link outright.
    const source = htmlToCarve('<p><a href="/u" data-carve-autolink="1">hi</a></p>').value
    expect(source).toBe('[hi](/u)\n')
  })

  it('binds one destination per RESOLUTION key, not per spelling', () => {
    // `r` and ` r ` are one label to the resolver, so comparing the spellings
    // let two carriers write two definitions under one key and sent both links
    // to the second destination.
    const source = htmlToCarve(
      '<p><a href="/u" data-carve-ref="r">a</a> <a href="/v" data-carve-ref=" r ">b</a></p>',
    ).value
    expect(carveToHtml(source)).toBe('<p><a href="/u">a</a> <a href="/v">b</a></p>')
  })

  it('keeps a reference link\u2019s own attributes inside the rebuilt spelling', () => {
    // `rawRef` is emitted VERBATIM by the writer, so the attribute block has
    // to be part of it.
    expect(back('[r]: /u\n\n[t][r]{.foo}\n')).toBe('[t][r]{.foo}\n\n[r]: /u\n')
    expect(back('[r]: /u\n\n![i][r]{width=20}\n')).toBe('![i][r]{width=20}\n\n[r]: /u\n')
  })

  it('rebuilds no autolink for a destination that has no autolink spelling', () => {
    // A relative destination matching its own text is still not an autolink:
    // `</u>` re-parses as literal text and the link is gone.
    expect(htmlToCarve('<p><a href="/u" data-carve-autolink="1">/u</a></p>').value).toBe('[/u](/u)\n')
  })

  it('rebuilds no autolink from a destination the matcher only partly reads', () => {
    // The autolink matcher is anchored at the start only, so a `>` inside the
    // destination matched its valid head and the tail came back as literal
    // text.
    const html = '<p><a href="https://e.com&gt;junk" data-carve-autolink="1">https://e.com&gt;junk</a></p>'
    expect(carveToHtml(htmlToCarve(html).value))
      .toBe('<p><a href="https://e.com&gt;junk">https://e.com&gt;junk</a></p>')
  })

  it('rebuilds no autolink where a title would be dropped by it', () => {
    // An autolink node has no title field, and the attribute pass has already
    // consumed the title as the link's own.
    expect(htmlToCarve('<p><a href="https://e.com" title="hi" data-carve-autolink="1">https://e.com</a></p>').value)
      .toBe('[https://e.com](https://e.com "hi")\n')
  })

  it('keeps a note written inline INSIDE another note, as a labelled one', () => {
    // A documented limit, not a loss: a labelled note's body is converted
    // before a later note's inline body is registered, so the nested note
    // keeps its content and its endnote and loses only the `^[...]` spelling.
    const source = back('x[^n]\n\n[^n]: a^[inline]\n')
    expect(source).toContain('[^n]: a[^1]')
    expect(source).toContain('[^1]: inline')
    expect(carveToHtml(source)).toBe(carveToHtml('x[^n]\n\n[^n]: a^[inline]\n'))
  })

  it('keeps two inline notes beside each other inline', () => {
    expect(back('z^[a] w^[b]\n')).toBe('z^[a] w^[b]\n')
  })

  it('keeps an authored footnote label the parser reads but a word does not', () => {
    expect(back('x[^my note]\n\n[^my note]: body\n')).toBe('x[^my note]\n\n[^my note]: body\n')
  })

  it('keeps a no-break space at the end of a reference label', () => {
    // `rawRef` is built from the written label, and trimming its end took a
    // character the label held rather than the writer's terminator.
    expect(back('[r]: /u\n\n[a\u00a0][r]\n')).toBe('[a\u00a0][r]\n\n[r]: /u\n')
  })

  it('keeps an authored footnote label that names an Object prototype key', () => {
    expect(back('x[^__proto__]\n\n[^__proto__]: note\n')).toBe('x[^__proto__]\n\n[^__proto__]: note\n')
  })

  it('keeps an authored numeric footnote label no other note needs', () => {
    expect(back('x[^2] y[^a]\n\n[^2]: two\n\n[^a]: ay\n'))
      .toBe('x[^2] y[^a]\n\n[^2]: two\n\n[^a]: ay\n')
  })

  it('does not reconstruct from a raw-preserved subtree in roundtrip mode', () => {
    // A `<span data-carve-raw>` inside something kept whole stays inside those
    // bytes: the raw preservation is what roundtrip mode promises for it.
    const source = htmlToCarve('<figure><span data-carve-raw="tex">\\x</span></figure>', { mode: 'roundtrip' }).value
    expect(source).toContain('\\x')
  })
})
