import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToCarve, carveToHtml, smartQuotes } from '../src/index.js'

const h = (source: string) => carveToHtml(source)

describe('smart quote direction rules', () => {
  it('judges a letter outside the BMP as a whole code point', () => {
    expect(h("say '𐐀")).toBe('<p>say ’𐐀</p>')
    expect(h("'one '𐐀 two'")).toBe('<p>‘one ’𐐀 two’</p>')
    expect(h("'𐐀bc' d")).toBe('<p>‘𐐀bc’ d</p>')
    expect(h("'em'𐐀")).toBe('<p>’em’𐐀</p>')
  })

  it('keeps previous-character context through empty blocks and attribute comments', () => {
    for (const block of ['{%%}', '{% hidden %}', '{%%}{% hidden %}']) {
      expect(h(`\\{${block}"q"`)).toBe('<p>{“q”</p>')
      expect(h(`(${block}"q"`)).toBe('<p>(“q”</p>')
      expect(h(`${block}"q"`)).toBe('<p>“q”</p>')
      expect(h(`x${block}"q"`)).toBe('<p>x”q”</p>')
      expect(h(`say ${block}'word`)).toBe('<p>say ’word</p>')
      expect(h(`"${block}'word`)).toBe('<p>“‘word</p>')
      expect(h(`\\{${block}'q'`)).toBe('<p>{‘q’</p>')
      for (const dash of ['-', '--', '---', '–', '—']) {
        const glyph = dash === '--' ? '–' : dash === '---' ? '—' : dash
        for (const quote of ['"', "'"]) {
          const closing = quote === '"' ? '”' : '’'
          const opening = quote === '"' ? '“' : '‘'
          expect(h(`word${dash}${block}${quote} `)).toBe(`<p>word${glyph}${closing}</p>`)
          expect(h(`word${dash}${block}${quote}q${quote}`)).toBe(`<p>word${glyph}${opening}q${closing}</p>`)
        }
      }
    }
    expect(h('[x]{.c}"q"')).toBe('<p><span class="c">x</span>”q”</p>')
    expect(h('[x]{.c}{%%}"q"')).toBe('<p><span class="c">x</span>”q”</p>')
    expect(h('word-"{%%}q"')).toBe('<p>word-“q”</p>')
    expect(h("'one {%%}'two' end'")).toBe('<p>‘one ’two’ end’</p>')
  })

  it('closes after each dash before end, whitespace, and closing punctuation', () => {
    for (const dash of ['-', '–', '—']) {
      for (const next of ['', ' ', '\t', '\n', '\u00a0', '"', "'", '.', ',', ';', ':', '!', '?', ')', ']']) {
        for (const quote of ['"', "'"]) {
          const output = h(`word${dash}${quote}${next}`)
          expect(output).toContain(`word${dash}${quote === '"' ? '”' : '’'}`)
        }
      }
    }
    expect(h('"Interrupted---" he said.')).toBe('<p>“Interrupted—” he said.</p>')
    expect(h("'Interrupted---' he said.")).toBe('<p>‘Interrupted—’ he said.</p>')
  })

  it('opens a quotation introduced by a dash', () => {
    for (const dash of ['-', '–', '—']) {
      expect(h(`word${dash}"Hello"`)).toBe(`<p>word${dash}“Hello”</p>`)
      expect(h(`word${dash}'Hello'`)).toBe(`<p>word${dash}‘Hello’</p>`)
    }
  })

  it('uses apostrophes for every listed elision, ignoring case', () => {
    for (const word of ['tis', 'tisn', 'twas', 'twasn', 'twere', 'twill', 'twould', 'em', 'cause', 'til', 'n', 'bout']) {
      for (const spelling of [word, word.toUpperCase()]) {
        expect(h(`'${spelling} here`)).toBe(`<p>’${spelling} here</p>`)
        expect(h(`'${spelling}'`)).toBe(`<p>‘${spelling}’</p>`)
      }
    }
    expect(h("'tisn't 'twasn't")).toBe('<p>’tisn’t ’twasn’t</p>')
    expect(h("'em'2")).toBe('<p>’em’2</p>')
    expect(h("'em'é")).toBe('<p>’em’é</p>')
    expect(h("'tissue")).toBe('<p>‘tissue</p>')
    expect(h("'tisé")).toBe('<p>‘tisé</p>')
  })

  it('does not nest single quotes and preserves mid-word and digit apostrophes', () => {
    expect(h("'one 'two' end'")).toBe('<p>‘one ’two’ end’</p>')
    expect(h("'one don't 'two' end'")).toBe('<p>‘one don’t ’two’ end’</p>')
    expect(h("'one '70s 'two' end'")).toBe('<p>‘one ’70s ’two’ end’</p>')
    expect(h("'one é'é 'two' end'")).toBe('<p>‘one é’é ’two’ end’</p>')
    expect(h("'one 'tis 'two' end'")).toBe('<p>‘one ’tis ’two’ end’</p>')
  })

  it('demotes only unmatched eligible openers', () => {
    expect(h("say 'word")).toBe('<p>say ’word</p>')
    expect(h("'word")).toBe('<p>‘word</p>')
    expect(h('say "\'word')).toBe('<p>say “‘word</p>')
    expect(h("say '*bold* text")).toBe('<p>say ‘<strong>bold</strong> text</p>')
    expect(h("say ' word")).toBe('<p>say ‘ word</p>')
    expect(h("'*bold* 'inner'")).toBe('<p>‘<strong>bold</strong> ’inner’</p>')
    expect(h("say 'one' 'two")).toBe('<p>say ‘one’ ’two</p>')
    expect(h("say 'word ' end")).toBe('<p>say ’word ‘ end</p>')
  })

  it('shares state through nested inline constructs and rewrites nested nodes', () => {
    expect(h("'one *'two* end'")).toBe('<p>‘one <strong>’two</strong> end’</p>')
    expect(h("say *x 'word*")).toBe('<p>say <strong>x ’word</strong></p>')
    expect(h("'one [x 'two](url) end'")).toBe('<p>‘one <a href="url">x ’two</a> end’</p>')
  })

  it('resets state for paragraphs, headings, list paragraphs, and table cells', () => {
    expect(h("'one\n\n'next'")).toBe('<p>‘one</p>\n<p>‘next’</p>')
    expect(h("# 'one\n\n'next'")).toContain('<p>‘next’</p>')
    expect(h("- 'one\n- 'next'")).toContain('<li>‘next’</li>')
    expect(h("| 'one | 'next' |\n|---|---|")).toContain('‘next’</th>')
  })

  it('isolates inline footnote quotes from the surrounding paragraph', () => {
    const output = h("say ^['note] 'two'")
    expect(output).toContain('</sup></a> ‘two’</p>')
    expect(output).toContain('<p>‘note<a href="#fnref1"')

    const open = h("say 'one ^[say 'note] 'two' end'")
    expect(open).toContain('<p>say ‘one ')
    expect(open).toContain('</sup></a> ’two’ end’</p>')
    expect(open).toContain('<p>say ’note<a href="#fnref1"')

    const closed = h("say 'one ^['note'] 'two' end'")
    expect(closed).toContain('</sup></a> ’two’ end’</p>')
    expect(closed).toContain('<p>‘note’<a href="#fnref1"')

    const unmatched = h("say 'one ^[note'] end")
    expect(unmatched).toContain('<p>say ’one ')
    expect(unmatched).toContain('<p>note’<a href="#fnref1"')
  })

  it('finalizes each note independently and shares state within its nested inlines', () => {
    const output = h("say ^[say *x 'note*] ^['other] 'two'")
    expect(output).toContain('<strong>x ’note</strong>')
    expect(output).toContain('<p>‘other<a href="#fnref2"')
    expect(output).toContain('</sup></a> ‘two’</p>')

    const nested = h("say ^['one [x 'two](url) end'] 'three'")
    expect(nested).toContain('‘one <a href="url">x ’two</a> end’')
    expect(nested).toContain('</sup></a> ‘three’</p>')

    const options = { extensions: [smartQuotes({ locale: 'de' })] }
    const localized = carveToHtml("say ^[say 'note] 'two'", options)
    expect(localized).toContain('<p>say ’note<a href="#fnref1"')
    expect(localized).toContain('</sup></a> ‚two‘</p>')
    const source = "say ^[say 'note] 'two'"
    expect(carveToCarve(source)).toContain("say 'note")
    expect(JSON.stringify(carveToAstJson(source))).toContain('right_single_quote')
  })

  it('keeps apostrophe glyphs locale-independent and preserves source and AST kinds', () => {
    const options = { extensions: [smartQuotes({ locale: 'de' })] }
    expect(carveToHtml("say 'word and 'tis", options)).toBe('<p>say ’word and ’tis</p>')
    expect(carveToHtml("'word'", options)).toBe('<p>‚word‘</p>')
    for (const source of ["say 'word", "'tis"]) {
      expect(carveToCarve(source)).toBe(`${source}\n`)
      const json = JSON.stringify(carveToAstJson(source))
      expect(json).toContain('right_single_quote')
      expect(json).not.toContain('left_single_quote')
    }
  })

  it('leaves escapes, code, raw spans, URLs, and attributes untouched', () => {
    expect(h("\\'tis \\\"word")).toBe('<p>\'tis "word</p>')
    expect(h("`'tis` and `'word`{=html}")).toBe("<p><code>'tis</code> and 'word</p>")
    expect(h("[x](https://example.com/'tis)")).toBe('<p><a href="https://example.com/&apos;tis">x</a></p>')
    expect(h("[x]{title=\"'tis\"}")).toBe('<p><span title="&apos;tis">x</span></p>')
    expect(carveToHtml("say 'word and 'tis", { smartTypography: false })).toBe("<p>say 'word and 'tis</p>")
  })
})
