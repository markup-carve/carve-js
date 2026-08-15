import { describe, expect, it } from 'vitest'
import type { Document } from '../src/ast.js'
import { carveToHtml, carveToMarkdown, markdownToCarve, renderMarkdown } from '../src/index.js'

/**
 * PART 11 section 9 forbids the two-trailing-space hard break ON THE MARKDOWN
 * TARGET, and the reason it gives is about the character, not about the break:
 * trailing whitespace is removed by editors that strip it on save, by
 * `git apply --whitespace=fix` and by CI whitespace checks, so a renderer that
 * emits it produces output ordinary tooling rewrites behind it. Section 7 makes
 * the same argument for the canonical writer, and PART 2's NO TRAILING
 * WHITESPACE clause drops the run on every content line, so the byte is one
 * Carve's own parser would not read back either.
 *
 * Every marker this target emits carries a space that separates it from its
 * content, and where the content is EMPTY the space is all that survives:
 *
 *     `> `      a blank line inside a block quote
 *     `- `      an item whose only content was collected out of the tree
 *     `1. `     the same, ordered
 *     `- [ ] `  the same, a task item
 *     `: `      a definition description, likewise emptied
 *     `## `     a heading with no text
 *     `[^a]: `  a footnote definition with an empty body
 *     `*[X]: `  an abbreviation definition with an empty expansion
 *
 * The blank quoted line is the one a cross-engine comparison surfaced
 * (markup-carve/carve#1147): carve-js wrote `>` plus a space where carve-php and
 * carve-rs wrote a bare `>`. The other seven are the same defect at sites that
 * comparison did not reach.
 *
 * BOTH SPELLINGS PARSE THE SAME. Measured against commonmark 0.31.2 and marked
 * 18.0.9: `> a\n>\n> b` and `> a\n> \n> b` render identical HTML, as do `-` and
 * `- `, `1.` and `1. `, `- [ ]` and `- [ ] `, `##` and `## `. Over the whole
 * conformance corpus the change moves 21 documents' bytes and 0 documents' HTML
 * under commonmark. marked is the only reader that shows a difference, and it
 * shows it by carrying the trailing space through into the text node - which is
 * the artifact being removed, not a meaning that is being lost.
 *
 * THE VERBATIM CONTROLS BELOW ARE THE POINT OF THE SHAPE OF THE FIX. A fenced
 * code block's body is the block's PAYLOAD, not a content line (PART 2, WHERE IT
 * DOES NOT REACH), so `abc<SP>` in a code body keeps its bytes - including
 * inside a quote, where it reaches the writer as content behind a `> `. That is
 * why the rule is applied to the marker when its CONTENT is empty, and not as a
 * sweep over the emitted line or over the finished document: either sweep would
 * corrupt corpus case 268-trailing-whitespace-on-a-content-line-is-dropped-9.
 */

/**
 * A significant space, never written as a literal inside a fixture string.
 *
 * The whole subject here is a trailing space, and a trailing space in a source
 * file is exactly what a formatter, an editor's strip-on-save and
 * `git apply --whitespace=fix` delete without saying so. A fixture that spelled
 * one literally would be silently repaired into a test that passes for the
 * wrong reason.
 */
const SP = ' '

/** Code points, so an assertion failure names the byte rather than showing blank space. */
const bytes = (s: string): string =>
  [...s].map((c) => c.codePointAt(0)!.toString(16).padStart(4, '0')).join(' ')

const trailingWsLines = (out: string): string[] =>
  out.split('\n').filter((line) => /[ \t]+$/.test(line))

const TAIL = { type: 'paragraph' as const, children: [{ type: 'text' as const, value: 'tail' }] }
const doc = (children: Document['children'], rest: Partial<Document> = {}): Document =>
  ({ type: 'document', children, ...rest }) as Document

describe('a Markdown marker with no content keeps no trailing space', () => {
  describe('the blank quoted line from markup-carve/carve#1147', () => {
    it('writes a bare `>`, not `>` and a space', () => {
      const out = carveToMarkdown('> a\n>\n> b\n')

      expect(bytes(out)).toBe(bytes('> a\n>\n> b\n'))
      // Asserted on the byte too, because the difference between the two
      // spellings is invisible in the literal above.
      expect(out.split('\n')[1]).toHaveLength(1)
      expect(out.split('\n')[1]).toBe('>')
    })

    it('writes a bare `> >` when the quote is nested', () => {
      const out = carveToMarkdown('> > a\n> >\n> > b\n')

      expect(bytes(out)).toBe(bytes('> > a\n> >\n> > b\n'))
      expect(out.split('\n')[1]).toHaveLength(3)
    })

    it('writes a bare `>` under the continuation pad of a list item', () => {
      const out = carveToMarkdown('- > a\n  >\n  > b\n')

      expect(bytes(out)).toBe(bytes('- > a\n  >\n  > b\n'))
      expect(out.split('\n')[1]).toBe('  >')
    })

    it('writes a bare `>` before a block that is not a paragraph', () => {
      const out = carveToMarkdown('> a\n>\n> ---\n')

      expect(out.split('\n')[1]).toBe('>')
      expect(trailingWsLines(out)).toEqual([])
    })
  })

  describe('a list marker whose item was emptied', () => {
    it('writes a bare `-`', () => {
      const out = carveToMarkdown('- [ref]: /url\n\nSee [it][ref].\n')

      expect(out.split('\n')[0]).toBe('-')
      expect(out.split('\n')[0]).toHaveLength(1)
    })

    it('writes a bare `1.` for an ordered item', () => {
      const out = renderMarkdown(
        doc([
          { type: 'list', ordered: true, items: [{ type: 'list_item', children: [] }, { type: 'list_item', children: [TAIL] }] },
        ] as unknown as Document['children']),
      )

      expect(bytes(out)).toBe(bytes('1.\n2. tail\n'))
    })

    it('writes a bare `- [ ]` for a task item', () => {
      const out = renderMarkdown(
        doc([
          { type: 'list', items: [{ type: 'list_item', checked: false, children: [] }, { type: 'list_item', children: [TAIL] }] },
        ] as unknown as Document['children']),
      )

      expect(bytes(out)).toBe(bytes('- [ ]\n- tail\n'))
    })
  })

  it('writes a bare `:` for a definition description that was emptied', () => {
    const out = carveToMarkdown(':: term\n:  [r]: /u\n\nsee [t][r]\n')

    expect(out.split('\n')[1]).toBe(':')
    expect(trailingWsLines(out)).toEqual([])
  })

  describe('the sites a hand-built tree reaches (PART 11 section 1a)', () => {
    it('writes a bare `##` for a heading with no text', () => {
      const out = renderMarkdown(
        doc([{ type: 'heading', level: 2, children: [] }, TAIL] as unknown as Document['children']),
      )

      expect(bytes(out)).toBe(bytes('##\n\ntail\n'))
    })

    it('writes a bare `>` for a quote with no children', () => {
      const out = renderMarkdown(
        doc([{ type: 'block_quote', children: [] }, TAIL] as unknown as Document['children']),
      )

      expect(bytes(out)).toBe(bytes('>\n\ntail\n'))
    })

    it('writes a bare `*[X]:` for an abbreviation with an empty expansion', () => {
      const out = renderMarkdown(
        doc([{ type: 'abbreviation_def', abbr: 'X', expansion: '' }, TAIL] as unknown as Document['children']),
      )

      expect(bytes(out)).toBe(bytes('*[X]:\n\ntail\n'))
    })

    it('writes a bare `[^a]:` for a footnote with an empty body', () => {
      const out = renderMarkdown(doc([TAIL] as unknown as Document['children'], { footnoteDefs: { a: [], b: [TAIL] } } as Partial<Document>))

      expect(bytes(out)).toBe(bytes('tail\n\n[^a]:\n[^b]: tail\n'))
    })
  })

  describe('verbatim payload keeps its bytes', () => {
    it('keeps a trailing space in a fenced code body', () => {
      const source = '```\nabc' + SP + '\n```\n\ntail\n'
      const out = carveToMarkdown(source)

      expect(out.split('\n')[1]).toBe('abc' + SP)
      expect(out.split('\n')[1]).toHaveLength(4)
      expect(bytes(out.split('\n')[1])).toBe('0061 0062 0063 0020')
    })

    it('keeps a trailing space in a fenced code body inside a quote', () => {
      const source = '> ```\n> abc' + SP + '\n> ```\n\ntail\n'
      const out = carveToMarkdown(source)

      expect(out.split('\n')[1]).toBe('> abc' + SP)
      expect(bytes(out.split('\n')[1])).toBe('003e 0020 0061 0062 0063 0020')
    })

    it('keeps a code line that is a single space inside a quote', () => {
      const source = '> ```\n> a\n>' + SP + SP + '\n> b\n> ```\n\ntail\n'
      const out = carveToMarkdown(source)

      expect(out.split('\n')[2]).toBe('>' + SP + SP)
      expect(bytes(out.split('\n')[2])).toBe('003e 0020 0020')
    })

    it('still writes a bare `>` for a code body line that is EMPTY', () => {
      const out = carveToMarkdown('> ```\n> a\n>\n> b\n> ```\n')

      expect(out.split('\n')[2]).toBe('>')
    })
  })

  describe('the output is stable under the tooling the rule is about', () => {
    const shapes = [
      '> a\n>\n> b\n',
      '- [ref]: /url\n\nSee [it][ref].\n',
      ':: term\n:  [r]: /u\n\nsee [t][r]\n',
      '- > a\n  >\n  > b\n',
      '> a\n>\n> ---\n',
    ]

    it('emits no line ending in a space or a tab', () => {
      for (const source of shapes) expect(trailingWsLines(carveToMarkdown(source))).toEqual([])
    })

    it('is unchanged by a strip-trailing-whitespace pass, which is what idempotence costs here', () => {
      for (const source of shapes) {
        const out = carveToMarkdown(source)
        const stripped = out
          .split('\n')
          .map((line) => line.replace(/[ \t]+$/, ''))
          .join('\n')

        expect(bytes(stripped)).toBe(bytes(out))
      }
    })

    it('renders the same bytes on a second pass', () => {
      for (const source of shapes) {
        const once = carveToMarkdown(source)

        expect(bytes(carveToMarkdown(source))).toBe(bytes(once))
      }
    })

    it('reads back to the same document through the Markdown reader in this repository', () => {
      for (const source of shapes) {
        const emitted = carveToMarkdown(source)
        const withSpaces = emitted
          .split('\n')
          .map((line) => (/^([ ]*)(>+|-|\d+\.|- \[[ x]\]|:)$/.test(line) ? line + SP : line))
          .join('\n')

        expect(carveToHtml(markdownToCarve(emitted))).toBe(carveToHtml(markdownToCarve(withSpaces)))
      }
    })
  })
})
