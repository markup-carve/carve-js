import { describe, expect, it } from 'vitest'
import { carveToAnsi, carveToCarve, carveToHtml, carveToPlainText, semanticSpan } from '../src/index.js'

const CORE = ['abbr', 'time', 'kbd'] as const
const EXTENSION_ONLY = ['samp', 'var', 'cite', 'dfn'] as const

/*
 * PART 9 §9/§10, the tier split. Core reserves three SPAN ATTRIBUTES; the four
 * other names and the `:name[...]` spelling are the SemanticSpan extension's.
 *
 * The pairs matter more than the rows: every assertion here has a twin with the
 * extension off, because "renders <samp>" and "renders <samp> only when asked"
 * are different claims and a suite that only ever registers the extension
 * cannot tell them apart.
 */
describe('core semantic span attributes', () => {
  for (const name of CORE) {
    it(`consumes ${name} with no extension registered`, () => {
      expect(carveToHtml(`[x]{${name}}`)).toBe(`<p><${name}>x</${name}></p>`)
    })
  }

  for (const name of EXTENSION_ONLY) {
    it(`leaves ${name} an ordinary attribute with no extension registered`, () => {
      expect(carveToHtml(`[x]{${name}}`)).toBe(`<p><span ${name}="">x</span></p>`)
    })
  }

  it('maps a value to the attribute it stands for', () => {
    expect(carveToHtml('[HTML]{abbr="HyperText Markup Language"}'))
      .toBe('<p><abbr title="HyperText Markup Language">HTML</abbr></p>')
    expect(carveToHtml('[now]{time="2026-01-01"}'))
      .toBe('<p><time datetime="2026-01-01">now</time></p>')
  })

  it('yields a derived attribute to an authored one of the same name', () => {
    expect(carveToHtml('[x]{abbr="derived" title="authored"}'))
      .toBe('<p><abbr title="authored">x</abbr></p>')
  })

  it('rides leftovers on the outermost element instead of a wrapper', () => {
    expect(carveToHtml('[Tab]{#k .key kbd}')).toBe('<p><kbd id="k" class="key">Tab</kbd></p>')
    expect(carveToHtml('[x]{kbd onclick="alert(1)"}')).toBe('<p><kbd>x</kbd></p>')
  })

  it('keeps the span where no name was consumed', () => {
    expect(carveToHtml('[x]{}')).toBe('<p><span>x</span></p>')
    expect(carveToHtml('[x]{onclick="alert(1)"}')).toBe('<p><span>x</span></p>')
  })

  it('nests several in the fixed order, not the authored one', () => {
    expect(carveToHtml('[x]{kbd abbr="A"}')).toBe(carveToHtml('[x]{abbr="A" kbd}'))
    expect(carveToHtml('[x]{kbd abbr="A"}')).toBe('<p><kbd><abbr title="A">x</abbr></kbd></p>')
  })

  it('registers no :name[...] handler at all', () => {
    for (const name of [...CORE, ...EXTENSION_ONLY, 'code', 'mark']) {
      expect(carveToHtml(`:${name}[x]`)).toBe(`<p><span class="ext-${name}">x</span></p>`)
    }
  })

  it('carries the AUTHORED expansion on plain and ANSI, and preserves the source', () => {
    // An authored `abbr` has no `*[TERM]: …` definition line to carry its
    // expansion, so a target that drops it loses the text outright. Both of
    // these print it parenthetically - the idiom each already uses for an
    // ordinary abbreviation, and on plain the idiom it already uses for an
    // inline footnote (markup-carve/carve#1176).
    //
    // This row previously asserted `HTML\n` on plain and only `toContain('HTML')`
    // on ANSI. The loose ANSI assertion hid that this test's own title was
    // already wrong there: ANSI has always appended the expansion, so "content
    // only on plain and ANSI" described neither target accurately.
    const source = '[*HTML*]{abbr="HyperText Markup Language"}'
    expect(carveToPlainText(source)).toBe('HTML (HyperText Markup Language)\n')
    expect(carveToAnsi(source)).toContain('(HyperText Markup Language)')
    expect(carveToCarve(source)).toBe(source + '\n')
  })

  it('prints no expansion when the authored abbr is empty', () => {
    // `{abbr=""}` is the spelling for "mark this as an abbreviation with no
    // expansion" - HTML emits a bare `<abbr>`, so the flattening targets add
    // nothing. This is what keeps `abbr=""` and `abbr="X"` distinguishable.
    const source = '[HTML]{abbr=""}'
    expect(carveToPlainText(source)).toBe('HTML\n')
    expect(carveToHtml(source)).toBe('<p><abbr>HTML</abbr></p>')
  })
})

describe('the SemanticSpan extension', () => {
  const html = (src: string) => carveToHtml(src, { extensions: [semanticSpan()] })

  for (const name of EXTENSION_ONLY) {
    it(`consumes ${name} when registered`, () => {
      expect(html(`[x]{${name}}`)).toBe(`<p><${name}>x</${name}></p>`)
    })
  }

  it('maps a dfn value to title, and rides leftovers like core', () => {
    // The DERIVED attribute leads the authored ones, which is what PART 10 §1
    // already says for every attribute an element derives from its own markup
    // (an `<ol>`'s type, a link's href): structural first, authored after, in
    // source order.
    expect(html('[CSS]{#c dfn="Cascading Style Sheets"}'))
      .toBe('<p><dfn title="Cascading Style Sheets" id="c">CSS</dfn></p>')
  })

  it('nests its names with core\'s in one order', () => {
    expect(html('[x]{cite kbd samp}')).toBe('<p><cite><kbd><samp>x</samp></kbd></cite></p>')
  })

  it('accepts the deprecated :name[...] spelling for all seven', () => {
    expect(html(':kbd[Ctrl]')).toBe('<p><kbd>Ctrl</kbd></p>')
    expect(html(':samp[out]{.o}')).toBe('<p><samp class="o">out</samp></p>')
  })

  it('claims no name outside the seven', () => {
    expect(html(':code[x]')).toBe('<p><span class="ext-code">x</span></p>')
    expect(html('[x]{mark}')).toBe('<p><span mark="">x</span></p>')
  })
})
