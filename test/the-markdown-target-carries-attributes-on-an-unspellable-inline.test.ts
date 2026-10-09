import { describe, expect, it } from 'vitest'
import {
  fromAstJson,
  markdownToCarve,
  parse,
  renderHtml,
  renderMarkdown,
  resolve,
} from '../src/index.js'

// markup-carve/carve#2839. PART 11 §8c (CARVE-P11-045): `underline`,
// `highlight`, `subscript` and `superscript` have no Markdown delimiter
// spelling and fall back to inline HTML, carrying their attribute set onto the
// element they emit. The target used to emit the tag bare, so an authored
// attribute left the document at the writer and was unrecoverable.
const md = (source: string) => renderMarkdown(resolve(parse(source)))

const CONSTRUCTS: Array<[string, string, string]> = [
  ['superscript', 'x{^2^}{.c} y', 'x<sup class="c">2</sup> y\n'],
  ['highlight', 'h =hi={.c} y', 'h <mark class="c">hi</mark> y\n'],
  ['underline', 'u _u_{.c} y', 'u <u class="c">u</u> y\n'],
  ['subscript', 's {,s,}{.c} y', 's <sub class="c">s</sub> y\n'],
]

describe('the Markdown target carries attributes on an unspellable inline', () => {
  it.each(CONSTRUCTS)('%s carries a class onto its element', (_name, source, expected) => {
    expect(md(source)).toBe(expected)
  })

  it('carries every attribute kind, not only a class', () => {
    expect(md('id {^2^}{#sid} y')).toBe('id <sup id="sid">2</sup> y\n')
    expect(md('kv =hi={data-x=1} y')).toBe('kv <mark data-x="1">hi</mark> y\n')
    expect(md('multi _u_{#uid .c1 .c2 data-k=v} y')).toBe('multi <u id="uid" class="c1 c2" data-k="v">u</u> y\n')
    expect(md('sub {,s,}{#k .c} y')).toBe('sub <sub id="k" class="c">s</sub> y\n')
  })

  // The control that keeps the fix from leaving an empty attribute artifact.
  it('leaves a construct with no attributes a bare tag', () => {
    expect(md('bare {^2^} =hi= _u_ {,s,} y')).toBe('bare <sup>2</sup> <mark>hi</mark> <u>u</u> <sub>s</sub> y\n')
  })

  // The assertion that matters. The tag returns as raw inline HTML rather than
  // as the construct, which is markup-carve/carve#2838's subject, not this one,
  // but the attribute is no longer lost at the writer.
  it.each(CONSTRUCTS)('%s keeps its attribute across a round trip', (_name, source) => {
    expect(markdownToCarve(md(source))).toContain('class="c"')
  })

  // The HTML target was already right.
  it.each(CONSTRUCTS)('%s is unchanged on the HTML target', (_name, source) => {
    expect(renderHtml(resolve(parse(source)))).toContain('class="c"')
  })

  // The two constructs §8c already gave an attribute rule. Neither can be
  // authored in Carve source, so they are reached through the AST.
  it('leaves small_caps and ruby carrying their attributes', () => {
    const inline = (node: unknown) => renderMarkdown(fromAstJson({
      type: 'document',
      srcByteLength: 0,
      children: [{ type: 'paragraph', children: [node] }],
    } as never))

    expect(inline({
      type: 'small_caps',
      attrs: { classes: ['c'] },
      children: [{ type: 'text', value: 'sc' }],
    })).toBe('<span class="smallcaps c">sc</span>\n')

    expect(inline({
      type: 'ruby',
      attrs: { classes: ['c'] },
      pairs: [{ base: [{ type: 'text', value: 'x' }], annotation: [{ type: 'text', value: 'r' }] }],
    })).toBe('<ruby class="c">x<rp>(</rp><rt>r</rt><rp>)</rp></ruby>\n')
  })
})
