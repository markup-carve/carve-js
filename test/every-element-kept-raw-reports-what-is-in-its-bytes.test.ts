/*
 * `roundtrip` keeps an element with no Carve spelling as raw HTML and the bytes
 * stay whole, so the report - not the output - is what has to name every
 * refused attribute in them (markup-carve/carve#2261, clause
 * `docs/html-import-contract.md` under *Modes* and `attribute-preserved`).
 *
 * `test/a-raw-kept-element-reports-what-is-inside-it.test.ts` pins that on
 * `<form>`. This file asks the questions one element cannot answer: which
 * elements reach the raw-keep path at all, whether the two arms that reach it
 * agree, whether the element's OWN attributes are covered as well as a
 * descendant's, and where a refusal correctly does not exist.
 *
 * The `style` question is deliberately absent: what `roundtrip` reports for
 * dangerous CSS in kept bytes is open as markup-carve/carve#2267 and no clause
 * pins the wording yet, so these tests assert around it rather than freezing
 * either answer.
 */
import { describe, expect, it } from 'vitest'
import { htmlToCarve } from '../src/index.js'

type Row = [string, string, string, string]

const report = (html: string, mode: 'roundtrip' | 'safe' | 'semantic' = 'roundtrip'): Row[] =>
  htmlToCarve(html, { mode }).report.diagnostics.map((d) => [d.code, d.severity, d.path!, d.message] as Row)

/** The report with the rows the open #2267 question owns left out. */
const settled = (html: string): Row[] => report(html).filter((row) => row[0] !== 'style-unmapped')

const value = (html: string, mode: 'roundtrip' | 'safe' = 'roundtrip') => htmlToCarve(html, { mode }).value

/** The four elements with no Carve spelling that `blocks()` keeps as a raw BLOCK. */
const BLOCK_ARM = ['form', 'fieldset', 'address', 'hgroup']
/** Elements with no Carve spelling that the inline arm keeps as a raw SPAN. */
const INLINE_ARM = ['output', 'progress', 'meter', 'object', 'canvas', 'video', 'audio', 'map', 'button', 'picture']

describe('every element kept raw reports what is in its bytes', () => {
  /*
   * The payload of markup-carve/carve#2267, which is #2261's payload with a
   * dangerous `style` added. The handler and the denied destination are the
   * settled half and must both be reported; the `style` rows are #2267's.
   */
  it('leaves no handler and no denied destination unreported in the #2267 payload', () => {
    const html = '<form style="background:url(javascript:x)" onclick="y()"><a href="javascript:alert(1)">t</a></form>'
    expect(settled(html)).toEqual([
      ['attribute-preserved', 'error', '/form[1]', 'Preserved event-handler attribute onclick on <form> in the raw HTML this element is kept as'],
      ['raw-preserved', 'warning', '/form[1]', 'Preserved unsupported <form> element as raw HTML'],
      ['attribute-preserved', 'error', '/form[1]/a[1]', 'Preserved href with a denied URL scheme on <a> inside the raw HTML <form> is kept as'],
    ])
    // The bytes stay whole, which is the half of the clause the report exists to
    // make honest rather than to hide.
    expect(value(html)).toContain('onclick="y()"')
    expect(value(html)).toContain('href="javascript:alert(1)"')
  })

  it.each(BLOCK_ARM)('reports the same rows for a raw-kept <%s> block', (tag) => {
    const html = `<${tag} onclick="own()"><a href="javascript:alert(1)" onclick="y()">t</a></${tag}>`
    expect(settled(html)).toEqual([
      ['attribute-preserved', 'error', `/${tag}[1]`, `Preserved event-handler attribute onclick on <${tag}> in the raw HTML this element is kept as`],
      ['raw-preserved', 'warning', `/${tag}[1]`, `Preserved unsupported <${tag}> element as raw HTML`],
      ['attribute-preserved', 'error', `/${tag}[1]/a[1]`, `Preserved href with a denied URL scheme on <a> inside the raw HTML <${tag}> is kept as`],
      ['attribute-preserved', 'error', `/${tag}[1]/a[1]`, `Preserved event-handler attribute onclick on <a> inside the raw HTML <${tag}> is kept as`],
    ])
    expect(value(html)).toContain('```=html\n')
  })

  it.each(INLINE_ARM)('reports the same rows for a raw-kept <%s> span', (tag) => {
    const html = `<p>a <${tag} onclick="own()"><a href="javascript:alert(1)" onclick="y()">t</a></${tag}> b</p>`
    expect(settled(html)).toEqual([
      ['attribute-preserved', 'error', `/p[1]/${tag}[2]`, `Preserved event-handler attribute onclick on <${tag}> in the raw HTML this element is kept as`],
      ['raw-preserved', 'warning', `/p[1]/${tag}[2]`, `Preserved unsupported <${tag}> element as raw HTML`],
      ['attribute-preserved', 'error', `/p[1]/${tag}[2]/a[1]`, `Preserved href with a denied URL scheme on <a> inside the raw HTML <${tag}> is kept as`],
      ['attribute-preserved', 'error', `/p[1]/${tag}[2]/a[1]`, `Preserved event-handler attribute onclick on <a> inside the raw HTML <${tag}> is kept as`],
    ])
    expect(value(html)).toContain('`{=html}')
  })

  /*
   * `<dialog>` is the one that cannot ride the sweep above: HTML's parser CLOSES
   * an open `<p>` before it, so it arrives at top level, and carve-js's `BLOCK`
   * set does not hold it, so it is still kept as an inline raw span. The report
   * has to be right for that combination too.
   */
  it('reports a raw-kept <dialog> at the level the parser puts it', () => {
    const html = '<p>a <dialog onclick="own()"><a href="javascript:alert(1)" onclick="y()">t</a></dialog> b</p>'
    expect(settled(html)).toEqual([
      ['attribute-preserved', 'error', '/dialog[2]', 'Preserved event-handler attribute onclick on <dialog> in the raw HTML this element is kept as'],
      ['raw-preserved', 'warning', '/dialog[2]', 'Preserved unsupported <dialog> element as raw HTML'],
      ['attribute-preserved', 'error', '/dialog[2]/a[1]', 'Preserved href with a denied URL scheme on <a> inside the raw HTML <dialog> is kept as'],
      ['attribute-preserved', 'error', '/dialog[2]/a[1]', 'Preserved event-handler attribute onclick on <a> inside the raw HTML <dialog> is kept as'],
    ])
    expect(value(html)).toContain('`{=html}')
  })

  /*
   * The ordering section makes a row follow the source, so two refusals on one
   * element read in the order that element spells them - not in the order the
   * importer happens to classify them. Both spellings, because one of them
   * passes for the wrong reason.
   */
  it('reports two refusals on one element in the order the element spells them', () => {
    expect(settled('<form onclick="a()" action="javascript:b()">t</form>').slice(0, 2)).toEqual([
      ['attribute-preserved', 'error', '/form[1]', 'Preserved event-handler attribute onclick on <form> in the raw HTML this element is kept as'],
      ['attribute-preserved', 'error', '/form[1]', 'Preserved action with a denied URL scheme on <form> in the raw HTML this element is kept as'],
    ])
    expect(settled('<form action="javascript:b()" onclick="a()">t</form>').slice(0, 2)).toEqual([
      ['attribute-preserved', 'error', '/form[1]', 'Preserved action with a denied URL scheme on <form> in the raw HTML this element is kept as'],
      ['attribute-preserved', 'error', '/form[1]', 'Preserved event-handler attribute onclick on <form> in the raw HTML this element is kept as'],
    ])
  })

  it('covers every class of refusal a descendant can carry', () => {
    const rows = (html: string) => settled(html).slice(1)
    expect(rows('<form><button formaction="javascript:x">b</button></form>')).toEqual([
      ['attribute-preserved', 'error', '/form[1]/button[1]', 'Preserved injection-sink attribute formaction on <button> inside the raw HTML <form> is kept as'],
    ])
    // A list-valued destination hides a denied scheme past the first entry,
    // where the renderer's leading-scheme sanitizer does not reach it.
    expect(rows('<form><img srcset="a.png 1x, javascript:alert(1) 2x" alt="a"></form>')).toEqual([
      ['attribute-preserved', 'error', '/form[1]/img[1]', 'Preserved srcset on <img> inside the raw HTML <form> is kept as: its value carries a javascript URL the renderer does not reach'],
    ])
    expect(rows('<form><a href="/ok" ping="/log javascript:alert(1)">t</a></form>')).toEqual([
      ['attribute-preserved', 'error', '/form[1]/a[1]', 'Preserved ping on <a> inside the raw HTML <form> is kept as: its value carries a javascript URL the renderer does not reach'],
    ])
    expect(rows('<form><div 9x="1">x</div></form>')).toEqual([
      ['attribute-preserved', 'info', '/form[1]/div[1]', 'Preserved unsupported attribute 9x on <div> inside the raw HTML <form> is kept as: not spellable as a Carve attribute name'],
    ])
  })

  /*
   * NO ELEMENT, NO REFUSAL. These four hold their content as text rather than as
   * markup, so the kept bytes carry no attribute to refuse and a row would name
   * a danger that is not there. The three spellings differ in how it is text,
   * which is why one case cannot stand for all of them.
   */
  it('adds no attribute row where the parse holds the content as text', () => {
    const inner = '<a href="javascript:alert(1)" onclick="y()">t</a>'
    // RCDATA: serialized back with the markup escaped.
    expect(report(`<textarea>${inner}</textarea>`)).toEqual([
      ['raw-preserved', 'warning', '/textarea[1]', 'Preserved unsupported <textarea> element as raw HTML'],
    ])
    expect(value(`<textarea>${inner}</textarea>`)).toContain('&lt;a href="javascript:alert(1)"')
    // RAWTEXT: serialized back unescaped, and re-parsed into the same text,
    // so the bytes LOOK like a live link and no reader ever builds one.
    for (const tag of ['iframe', 'noembed', 'xmp']) {
      expect(report(`<${tag}>${inner}</${tag}>`)).toEqual([
        ['raw-preserved', 'warning', `/${tag}[1]`, `Preserved unsupported <${tag}> element as raw HTML`],
      ])
    }
    // `<select>` takes no phrasing content at all: the parser drops the link
    // before the import sees it, so it is not in the bytes either.
    expect(value(`<select>${inner}</select>`)).not.toContain('javascript:')
  })

  /*
   * The boundary of the exception. `nav`, `aside` and `main` UNWRAP instead of
   * being kept, so nothing of theirs is in the output and their rows stay real
   * `attribute-dropped` drops - the reading the raw-keep path has to swap away
   * from, and must not swap away from here.
   */
  it.each(['nav', 'aside', 'main'])('keeps an unwrapped <%s> a real drop', (tag) => {
    const html = `<${tag}><a href="javascript:alert(1)" onclick="y()">t</a></${tag}>`
    expect(value(html)).not.toContain('javascript:')
    expect(report(html)).toEqual([
      ['element-unwrapped', 'info', `/${tag}[1]`, `Unwrapped unsupported <${tag}> element`],
      ['attribute-dropped', 'warning', `/${tag}[1]/a[1]`, 'Dropped event-handler attribute onclick on <a>'],
      ['attribute-dropped', 'warning', `/${tag}[1]/a[1]`, 'Dropped href with a denied URL scheme on <a>'],
    ])
  })

  /* CONTROL: nothing dangerous in the bytes, nothing but the keep in the report. */
  it('reports only the keep for a raw-kept element with nothing refused in it', () => {
    const html = '<form action="/save" method="post"><label for="q">Q</label></form>'
    expect(report(html)).toEqual([
      ['raw-preserved', 'warning', '/form[1]', 'Preserved unsupported <form> element as raw HTML'],
    ])
    expect(value(html)).toBe('```=html\n<form action="/save" method="post"><label for="q">Q</label></form>\n```\n')
  })

  /* CONTROL: `safe` removes instead of keeping, and says so, for the same input. */
  it('leaves safe removing what roundtrip keeps', () => {
    const html = '<form style="background:url(javascript:x)" onclick="y()"><a href="javascript:alert(1)">t</a></form>'
    expect(value(html, 'safe')).toBe('t\n')
    expect(report(html, 'safe').filter((row) => row[0] !== 'style-unmapped')).toEqual([
      ['element-unwrapped', 'info', '/form[1]', 'Unwrapped unsupported <form> element'],
      ['attribute-dropped', 'warning', '/form[1]', 'Dropped event-handler attribute onclick on <form>'],
      ['attribute-dropped', 'warning', '/form[1]/a[1]', 'Dropped href with a denied URL scheme on <a>'],
    ])
  })
})
