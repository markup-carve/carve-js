import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A DEFINITION INSIDE A CONTAINER INSIDE A FOOTNOTE BODY
 * (markup-carve/carve-js#1628).
 *
 * A line is TEXT or a DEFINITION, never both and never neither: a definition
 * renders nothing and registers a label, a non-definition renders literally and
 * registers nothing. This host broke the contract in BOTH directions.
 *
 *   A - visible AND active: a definition over-indented inside a `:::` container
 *       in a note body rendered as a paragraph AND resolved. The prepass had
 *       collected it; the block parser, flush-only, had not consumed it.
 *   B - invisible AND inert: `> [r]: /url` in a note body was consumed and did
 *       NOT register, so the reference dangled. The block parser had consumed
 *       it; the prepass, refusing any indented quote line, never saw it.
 *
 * THE TWO CONTAINERS DIFFER, which is the part worth keeping straight. A note
 * body's blocks are REBASED to an authored base, so a `:::` container absorbs
 * residual indentation and a definition at or past its column is a definition.
 * A quote is not rebased - its content column comes from its `>` marker - so an
 * indented definition after `>` is literal text there, exactly as at top level.
 */

const html = (s: string) => carveToHtml(s)
const visible = (s: string) => /\[r\]:/.test(html(s))
const resolves = (s: string) => /href="\/url"/.test(html(s))

/** The contract itself: exactly one of the two, never both, never neither. */
const consumedAndResolves = (s: string) => !visible(s) && resolves(s)
const textAndInert = (s: string) => visible(s) && !resolves(s)

const note = (body: string[]) =>
  '[^f]: b\n\n' + body.join('\n') + '\n\nSee [r][] and [^f].\n'
const top = (body: string[]) => body.join('\n') + '\n\nSee [r][].\n'
const pad = (n: number) => ' '.repeat(n)

describe('a definition in a container in a note body', () => {
  describe('A - a colon container absorbs the over-indent', () => {
    for (const col of [2, 3, 4, 5, 6]) {
      it(`is a definition at column ${col}`, () => {
        const src = note(['  ::: note', pad(col) + '[r]: /url', '  :::'])
        expect(consumedAndResolves(src), html(src)).toBe(true)
      })
    }

    it('holds when the container has a visible block first', () => {
      const src = note(['  ::: note', '  x', '', '   [r]: /url', '  :::'])
      expect(consumedAndResolves(src), html(src)).toBe(true)
    })

    it('holds inside a nested container', () => {
      const src = note(['  ::: a', '  ::: b', '   [r]: /url', '  :::', '  :::'])
      expect(consumedAndResolves(src), html(src)).toBe(true)
    })
  })

  describe('B - a quote registers at its own content column', () => {
    it('is a definition at the quote content column', () => {
      const src = note(['  > [r]: /url'])
      expect(consumedAndResolves(src), html(src)).toBe(true)
    })

    /*
     * THE QUOTE IS NOT REBASED. This is the control that separates the two
     * containers: a fix reading "a note body absorbs indentation" rather than
     * "a REBASED block absorbs it" makes these resolve, and the oracle leaves
     * them literal and inert.
     */
    for (const extra of [1, 2, 3]) {
      it(`is literal text ${extra} column(s) past the quote marker`, () => {
        const src = note(['  > ' + pad(extra) + '[r]: /url'])
        expect(textAndInert(src), html(src)).toBe(true)
      })
    }
  })

  describe('controls - the top-level twins do not move', () => {
    it('is a definition at the container own column', () => {
      expect(consumedAndResolves(top(['::: note', '[r]: /url', ':::']))).toBe(true)
    })

    for (const col of [1, 2, 3]) {
      it(`is literal text at column ${col} of a top-level container`, () => {
        const src = top(['::: note', pad(col) + '[r]: /url', ':::'])
        expect(textAndInert(src), html(src)).toBe(true)
      })
    }

    it('is a definition in a top-level quote', () => {
      expect(consumedAndResolves(top(['> [r]: /url']))).toBe(true)
    })

    it('is a definition at the note body own column', () => {
      expect(consumedAndResolves(note(['  [r]: /url']))).toBe(true)
    })
  })

  /*
   * `RE_LINK_DEF` matches `[^fn]: ...` too, and the flush-anchored footnote test
   * misses an INDENTED one - so widening the link-def arm for this host swallowed
   * a nested footnote definition and its reference dangled. Not a link-def row,
   * which is exactly why it needs its own.
   */
  it('does not swallow a nested footnote definition', () => {
    const out = html('[^f]: b\n\n  [^g]: inner\n\nSee [^f] and [^g].\n')
    expect(out).not.toContain('[^g]')
    expect(out).toContain('id="fn2"')
  })

  /*
   * FENCE OPACITY. A raised container's closer is left indented only when a
   * definition inside it was really CONSUMED - and a definition-shaped line
   * inside a code, raw or comment fence is payload that nothing consumes.
   * Asking the shape of the line instead of the region it sits in published the
   * container's own `:::` as text because of a string in a code sample.
   *
   * These rows are the ones that can fail the guard: every case above holds a
   * BARE definition, so a scan blind to fences passes all of them.
   */
  describe('fence opacity', () => {
    const raised = (inner: string[]) =>
      '[^f]: b\n\n   ::: note\n' + inner.map((l) => '    ' + l).join('\n') +
      '\n   :::\n\nSee [r][] and [^f].\n'

    for (const [name, inner] of [
      ['code fence', ['```', '[r]: /url', '```']],
      ['raw fence', ['```=html', '[r]: /url', '```']],
      ['comment fence', ['%%% c', '[r]: /url', '%%%']],
    ] as const) {
      it(`does not leak the closer for a definition inside a ${name}`, () => {
        const out = html(raised([...inner]))
        expect(out, out).not.toContain('<p>:::</p>')
        expect(out, out).not.toMatch(/<\/code>\s*\n:::/)
        // Payload, so nothing may resolve against it either.
        expect(/href="\/url"/.test(out), out).toBe(false)
      })
    }

    /*
     * A COMMENT FENCE NEEDS A CLOSER TO BE ONE. Unterminated, `%%%` is a
     * single-LINE comment, so a definition below it IS consumed and the closer
     * stays behind. A code fence is the other way round - unterminated it owns
     * the rest - and that twin is the control. Every opacity row above is
     * TERMINATED, so without these the closer-lookahead cannot be exercised.
     */
    it('treats an unterminated comment as one line, not an opaque region', () => {
      const out = html(raised(['%%% c', '[r]: /url']))
      expect(/href="\/url"/.test(out), out).toBe(true)
      expect(out, out).toContain(':::')
    })

    it('lets an unterminated CODE fence own the rest', () => {
      const out = html(raised(['```', '[r]: /url']))
      expect(/href="\/url"/.test(out), out).toBe(false)
    })

    it('still leaves the closer behind for a BARE definition', () => {
      const out = html(raised(['[r]: /url']))
      expect(out, out).toContain(':::')
      expect(/href="\/url"/.test(out), out).toBe(true)
    })
  })

  it('leaves a definition inside a code fence alone', () => {
    const src = note(['  ```', '  [r]: /url', '  ```'])
    expect(textAndInert(src), html(src)).toBe(true)
  })

  it('leaves a definition inside a raw fence alone', () => {
    const src = note(['  ```=html', '  [r]: /url', '  ```'])
    expect(resolves(src), html(src)).toBe(false)
  })
})
