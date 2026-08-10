import { describe, expect, it } from 'vitest'

import {
  carveToMarkdown,
  carveToAnsi,
  carveToPlainText,
  renderAnsi,
  renderMarkdown,
  renderPlainText,
  RenderDepthError,
  MAX_RENDER_DEPTH,
  type Document,
} from '../src/index.js'

const md = (s: string): string => carveToMarkdown(s).trim()

describe('Markdown renderer is safe-by-default', () => {
  it('blanks dangerous link/image schemes', () => {
    expect(md('[x](javascript:alert(1))')).toContain('[x]()')
    expect(md('![a](javascript:alert(1))')).toContain('![a]()')
    expect(md('[ok](https://e.com)')).toContain('[ok](https://e.com)')
  })

  it('blanks dangerous autolink schemes while preserving the visible label', () => {
    expect(md('<javascript:alert(1)>')).toBe('[javascript:alert(1)]()')
  })

  it('percent-encodes markdown destination breakout characters', () => {
    // A `)` reaching a destination via a reference definition (URL runs to
    // end-of-line, not `)`-delimited) is percent-encoded so it cannot break
    // out of the `(...)` in Markdown output.
    expect(md('[x][r]\n\n[r]: https://e.com/a)b')).toBe('[x](https://e.com/a%29b)')
  })

  it('keeps safe autolink destinations unchanged', () => {
    expect(md('<https://example.com>')).toBe('[https://example.com](https://example.com)')
  })

  it('escapes raw =html instead of emitting it', () => {
    const out = md('```=html\n<script>alert(1)</script>\n```')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })

  it('neutralizes embedded HTML in text and HTML-fallback tags', () => {
    expect(md('plain <img onerror=x> text')).not.toContain('<img')
    const sup = md('{^<img src=x onerror=alert(1)>^}')
    expect(sup).toContain('<sup>')
    expect(sup).not.toContain('<img')
  })

  it('entity-escapes < and > in text, and leaves & bare', () => {
    expect(md('a < b & c')).toBe('a &lt; b & c')
  })

  it('a bare ampersand cannot reintroduce a tag', () => {
    // The reason `&` stopped being escaped (carve#1071): an entity in Markdown
    // TEXT decodes to a CHARACTER, and a character cannot open a tag. Text
    // authored as `&lt;script&gt;` therefore comes back as the four characters
    // a reader sees, never as live markup - which is what a bare `<` would be,
    // and why `<` and `>` keep the entity form.
    expect(md('a &lt;script&gt; b')).toBe('a &lt;script&gt; b')
    expect(md('a <script>x</script> b')).toBe('a &lt;script&gt;x&lt;/script&gt; b')
  })

  it('escapes quotes and backslashes in link/image titles', () => {
    expect(md('[x](u "a \\"b\\" \\\\ c")')).toBe('[x](u "a \\"b\\" \\\\ c")')
    expect(md('![x](u "a \\"b\\" \\\\ c")')).toBe('![x](u "a \\"b\\" \\\\ c")')
  })

  it('keeps only the first fenced-code info token, dropping injection', () => {
    const doc: Document = {
      type: 'document',
      children: [{ type: 'code_block', lang: 'js\n```break', content: 'x' }],
    }

    // First whitespace-delimited token (`js`) survives; the `\n```break`
    // injection is dropped. Byte-identical across carve-php / carve-rs.
    expect(renderMarkdown(doc)).toBe('```js\nx\n```\n')
  })

  it('escapes Markdown image alt labels', () => {
    const doc: Document = {
      type: 'document',
      children: [
        {
          type: 'image',
          src: 'i.png',
          alt: String.raw`x](javascript:alert(1))![y\z`,
        },
      ],
    }

    expect(renderMarkdown(doc).trim()).toBe(
      String.raw`![x\](javascript:alert(1))!\[y\\z](i.png)`,
    )
  })
})

describe('ANSI/plain renderers strip terminal escapes', () => {
  it('removes ESC and other C0 controls on the terminal target (keeps tab/newline)', () => {
    const ansi = carveToAnsi('hi \x1b[31mX\x1b[0m\x07 there')
    expect(ansi).not.toContain('\x1b[31m')
    expect(ansi).not.toContain('\x07')
    expect(ansi).toContain('there')
  })

  it('KEEPS them on the plain target, which is a text serialization', () => {
    // PART 9 section 29 T3. The strip here was not a security measure on this
    // target - plain text is not a terminal format, and nothing downstream acts
    // on the byte - so it only made Carve the lossy party
    // (markup-carve/carve-js#896).
    const plain = carveToPlainText('a\x1bb\x07c')
    expect(plain).toContain('\x1b')
    expect(plain).toContain('\x07')
  })

  it('strips terminal controls from link hrefs', () => {
    const src = '[x](http://a/\x1b]0;PWNED\x07/b)'
    const ansi = carveToAnsi(src)
    const plain = carveToPlainText(src)

    expect(ansi).not.toContain('\x1b]0;PWNED')
    expect(ansi).not.toContain('\x07')
    expect(plain).not.toContain('\x1b')
    expect(plain).not.toContain('\x07')
    // plain text renders the link's visible text, not its href, so the
    // (sanitized) URL no longer appears at all -- which is strictly safer.
    expect(plain).toBe('x\n')
  })

  it('strips ESC/OSC controls from every author leaf in non-HTML renderers', () => {
    const osc = (s: string) => `\x1b]0;${s}\x07`
    const doc: Document = {
      type: 'document',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: `text${osc('TEXT')}` },
            { type: 'image', src: 'img.png', alt: `alt${osc('ALT')}` },
            { type: 'code', value: `code${osc('CODE')}` },
            { type: 'footnote_ref', id: `fn${osc('ID')}` },
            {
              type: 'substitution',
              oldText: `old${osc('OLD')}`,
              newText: `new${osc('NEW')}`,
            },
          ],
        },
      ],
      footnoteDefs: {
        [`label${osc('LABEL')}`]: [
          { type: 'paragraph', children: [{ type: 'text', value: `note${osc('NOTE')}` }] },
        ],
      },
    }

    // The TERMINAL target strips, at every leaf. It is the one consumer that
    // acts on the character (PART 9 section 29 T4).
    const ansi = stripAnsiStyles(renderAnsi(doc))
    expect(ansi).not.toContain('\x1b')
    expect(ansi).not.toContain('\x07')
    expect(ansi).not.toContain('\x1b]0;')

    // Markdown and plain EMIT it, at every one of those same leaves (T2, T3).
    // The leaf sweep is the point: a strip that survived on one node type would
    // be a hole in the other direction now.
    for (const out of [renderMarkdown(doc), renderPlainText(doc)]) {
      expect(out).toContain('\x1b')
      expect(out).toContain('\x07')
    }
  })

  it('strips controls from mention, tag, and symbol names in non-HTML renderers', () => {
    const doc: Document = {
      type: 'document',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'mention', user: 'al\x1bice' },
            { type: 'text', value: ' ' },
            { type: 'tag', name: 'ne\x07ws' },
            { type: 'text', value: ' ' },
            { type: 'symbol', name: 'ro\x1bcket' },
          ],
        },
      ],
    }

    const ansi = stripAnsiStyles(renderAnsi(doc))
    expect(ansi).not.toContain('\x1b')
    expect(ansi).not.toContain('\x07')
    expect(ansi).toContain('@alice')
    expect(ansi).toContain('#news')
    expect(ansi).toContain(':rocket:')

    for (const out of [renderMarkdown(doc), renderPlainText(doc)]) {
      expect(out).toContain('@al\x1bice')
      expect(out).toContain('#ne\x07ws')
      expect(out).toContain(':ro\x1bcket:')
    }
  })

  it('caps recursive rendering depth in non-HTML renderers', () => {
    const nest = (depth: number): Document => {
      let content: Document['children'][number]['children'] = [{ type: 'text', value: 'x' }]
      for (let i = 0; i < depth; i++) content = [{ type: 'span', children: content }]
      return { type: 'document', children: [{ type: 'paragraph', children: content }] }
    }

    // Under the ceiling the content is rendered, not merely "not thrown": a
    // renderer that dropped everything would also pass a no-throw assertion.
    for (const render of [renderMarkdown, renderPlainText, renderAnsi]) {
      expect(render(nest(MAX_RENDER_DEPTH - 2))).toContain('x')
    }

    // At and past it the render REFUSES with a typed error naming the bound
    // (§25), instead of overflowing the host stack or - the older behavior -
    // emitting the nested markers with the body deleted, which produces a
    // document that looks complete and is not.
    for (const render of [renderMarkdown, renderPlainText, renderAnsi]) {
      expect(() => render(nest(500))).toThrow(RenderDepthError)
    }
  })
})

function stripAnsiStyles(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}
