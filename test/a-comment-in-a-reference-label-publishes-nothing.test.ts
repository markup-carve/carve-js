import { describe, it, expect } from 'vitest'
import { carveToHtml, carveToMarkdown, carveToPlainText, carveToAnsi, carveToCarve, parse } from '../src/index.js'

/**
 * ONE FIELD, TWO CONTRACTS.
 *
 * `rawRef` is the authored source VERBATIM, and the Carve writer emits it
 * unchanged - which is what keeps `carve fmt` from rewriting a comment written
 * inside a reference label as a bare `%%` and destroying the author's text
 * (`markup-carve/carve-php#1417` is the same defect, still open there).
 *
 * Every RENDER target emits the same field for an unresolved reference, and it
 * needs the other string. The block layer EMPTIES a comment-only line before the
 * stanza is scanned as one inline run, so the text the inline layer was handed
 * has no comment in it - and "a comment renders nothing at any indent" leaves no
 * reading on which its bytes reach the page.
 *
 * `markup-carve/carve-js#1187` made the field a document slice, which fixed the
 * writer and published the comment (`carve-js#1192`). The split is at the
 * consumer now, so both halves hold at once - which neither engine had:
 * carve-php `925f7dc` renders it clean and loses it in `fmt`, and this engine
 * did the reverse.
 */

const SECRET = '::: |\n[a\n%% secret\nc][missing]\n:::\n'

describe('a comment written in a reference label publishes nothing', () => {
  const targets: Record<string, (src: string) => string> = {
    HTML: carveToHtml,
    Markdown: carveToMarkdown,
    'plain text': carveToPlainText,
    ANSI: carveToAnsi,
  }

  for (const [name, render] of Object.entries(targets)) {
    it(`keeps the comment out of the ${name} target`, () => {
      expect(render(SECRET)).not.toContain('secret')
    })
  }

  /**
   * THE BYTES, not just the absence. The comment's line is EMPTIED rather than
   * dropped, because the boundary it carried is still there - the block layer
   * leaves an empty line where it stood. carve-php renders exactly this.
   */
  it('leaves the line the comment stood on empty', () => {
    expect(carveToHtml(SECRET)).toBe(
      '<div class="line-block">\n  <p>[a\n\nc][missing]</p>\n</div>',
    )
  })

  const spellings: Record<string, string> = {
    'a reference with no definition': SECRET,
    'a collapsed reference': '::: |\n[a\n%% secret\nc][]\n:::\n',
    'a reference image': '::: |\n![a\n%% secret\nc][missing]\n:::\n',
  }

  for (const [label, src] of Object.entries(spellings)) {
    it(`publishes nothing for ${label}`, () => {
      expect(carveToHtml(src)).not.toContain('secret')
    })

    /**
     * THE OTHER CONTRACT, and the reason this is a split rather than a revert:
     * the writer still emits the authored source, so a round trip keeps the
     * author's text. These stay green with the render fix reverted - they are
     * `#1187`'s own claim, restated here as the half that must not regress.
     */
    it(`keeps the author's text through a round trip for ${label}`, () => {
      expect(carveToCarve(src)).toContain('%% secret')
      expect(carveToCarve(carveToCarve(src))).toContain('%% secret')
    })
  }

  /**
   * THE TREE CARRIES IT TOO, for the two LINK spellings. The image form does
   * not, and cannot as the AST stands: an image's label becomes its `alt`
   * string, so a comment written inside one survives in `rawRef` and nowhere a
   * consumer would look. Recorded here rather than asserted away - the writer
   * still round-trips it, which is why it is not a loss.
   */
  it('keeps the comment in the tree for the link spellings', () => {
    const comments = (node: unknown, out: string[] = []): string[] => {
      if (!node || typeof node !== 'object') return out
      const n = node as Record<string, any>
      if (String(n.type ?? '').includes('comment')) out.push(String(n.content ?? ''))
      for (const key of Object.keys(n)) if (Array.isArray(n[key])) n[key].forEach((c) => comments(c, out))
      return out
    }

    expect(comments(parse(SECRET))).toEqual(['secret'])
    expect(comments(parse('::: |\n[a\n%% secret\nc][]\n:::\n'))).toEqual(['secret'])
    expect(comments(parse('::: |\n![a\n%% secret\nc][missing]\n:::\n'))).toEqual([])
  })

  /**
   * THE INTENDED SURVIVOR. A `%%` inside a PARAGRAPH is an inline comment, which
   * the inline parse sees - the block layer empties nothing, so the literal
   * source really does carry it and both engines publish it. A fix that emptied
   * every `%%` run in the field would take this one too.
   */
  it('leaves an inline comment in a paragraph alone', () => {
    expect(carveToHtml('[a %% secret\nc][missing]\n')).toBe('<p>[a %% secret\nc][missing]</p>')
  })

  it('leaves a reference with no comment in it untouched', () => {
    expect(carveToHtml('::: |\n[a\nc][missing]\n:::\n')).toBe(
      '<div class="line-block">\n  <p>[a\nc][missing]</p>\n</div>',
    )
  })
})
