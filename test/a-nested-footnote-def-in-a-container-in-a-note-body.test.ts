import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A NESTED FOOTNOTE DEFINITION IN A CONTAINER IN A FOOTNOTE BODY IS REGISTERED
 * (markup-carve/carve-js#1638).
 *
 * The footnote-def analog of #1644: a container inside a host body that
 * consumes a hosted LINK definition consumes a hosted FOOTNOTE definition the
 * same way - the def is taken out of the container and registered as a
 * document-level endnote, and a reference to it resolves. `RE_FOOTNOTE_DEF` is
 * flush-anchored, so an indented nested one was missed: it dangled and rendered
 * as prose inside the container. `parseFootnoteDef` now strips the marker's
 * indent, and an indented footnote def in a consuming container dispatches to
 * it just as the flush one does.
 */

const html = (s: string) => carveToHtml(s)
// A registered def is consumed and its reference resolves, so no literal `[^g]`
// survives anywhere; a dangling def leaves the marker as text.
const registers = (s: string) => !html(s).includes('[^g]')
const dangles = (s: string) => html(s).includes('[^g]')

const note = (body: string[]) =>
  '[^f]: b\n\n' + body.join('\n') + '\n\nSee [^f] and [^g].\n'
const pad = (n: number) => ' '.repeat(n)

describe('a nested footnote def in a container in a note body', () => {
  describe('a colon container registers it past its own column', () => {
    for (const col of [2, 3, 4]) {
      it(`registers a footnote def at column ${col}`, () => {
        const src = note(['  ::: note', pad(col) + '[^g]: inner', '  :::'])
        expect(registers(src), html(src)).toBe(true)
        // consumed from the container: no literal marker survives
        expect(html(src)).not.toContain('[^g]: inner')
      })
    }

    it('registers it inside a nested container', () => {
      const src = note(['  ::: a', '  ::: b', '   [^g]: inner', '  :::', '  :::'])
      expect(registers(src), html(src)).toBe(true)
    })

    it('registers it inside a raised div (container at column 3)', () => {
      const src = '[^f]: b\n\n   ::: note\n    [^g]: inner\n   :::\n\nSee [^f] and [^g].\n'
      expect(registers(src), html(src)).toBe(true)
    })
  })

  it('registers a quote lazy footnote def in a note body', () => {
    const src = note(['  > q', '  [^g]: inner'])
    expect(registers(src), html(src)).toBe(true)
  })

  describe('controls - unchanged', () => {
    it('a footnote def at the note body own column registers', () => {
      expect(registers(note(['  [^g]: inner']))).toBe(true)
    })

    it('a footnote def at a TOP-LEVEL container column registers (flush path)', () => {
      const src = '::: note\n[^g]: inner\n:::\n\nSee [^g].\n'
      expect(registers(src), html(src)).toBe(true)
    })

    // The host-keyed boundary: a top-level container gets no such leniency, so a
    // footnote def indented PAST its column stays text, exactly as a link def
    // does. A fix that read "any container registers an over-indent" breaks this.
    it('a footnote def one past a TOP-LEVEL container dangles', () => {
      const src = '::: note\n [^g]: inner\n:::\n\nSee [^g].\n'
      expect(dangles(src), html(src)).toBe(true)
    })
  })
})
