import { describe, it, expect } from 'vitest'
import { carveToAstJson } from '../src/index.js'

/**
 * markup-carve/carve-js#1963, mirroring carve-rs#1559.
 *
 * The #1630 frame prepends three codepoints (U+0000 L U+0000) to a line the
 * enclosing container folds into an unterminated fence, so a closer written
 * among those lines stays body. The frame occupies NO source, and the offset
 * map already anchors a framed line to its unframed content - but the end of a
 * span was measured from the framed line's own length, so the frame's width
 * leaked into every span whose end fell on a framed line, running a fence's end
 * three columns past its last character and its end offset past document length
 * (corpus 455 reported a code block at span 0..26 in a 24-byte document).
 *
 * Assert by BOUND, not a fixed number: no span may end past the document, and
 * every span must slice back to source. HTML for these shapes is pinned by
 * `an-unfinished-fence-on-a-nested-lead-owns-its-body`; this file guards the
 * POSITIONS the HTML test cannot see.
 */
describe('a framed fence body keeps its span inside the document', () => {
  const shapes: Record<string, string> = {
    'corpus-455': ':: t\n: - ``` x\ncode\n```\n',
    'corpus-455-2': ':: t\n: - ~~~ x\ncode\n~~~\n',
    'corpus-455-3': ':: t\n: - ```\ncode\n```\n',
    'nested-list-flush': '- - ``` x\ncode\n```\n',
    'triple-nested': '- - - ``` x\ncode\n```\n',
    'quote-host': '> - ``` x\ncode\n```\n',
    'raw-html-fold': '- - ```=html\n<b>x</b>\n```\n',
  }

  for (const [name, src] of Object.entries(shapes)) {
    it(`${name}: no span ends past the document, every span slices back`, () => {
      const doc = carveToAstJson(src)
      const bound = doc.srcByteLength ?? Buffer.byteLength(src, 'utf8')
      const buf = Buffer.from(src, 'utf8')
      const seen = new Set<unknown>()
      const walk = (node: unknown): void => {
        if (!node || typeof node !== 'object' || seen.has(node)) return
        seen.add(node)
        const rec = node as Record<string, unknown>
        const pos = rec.pos as
          | { startOffset?: number; endOffset?: number; startColumn?: number }
          | undefined
        if (pos) {
          const type = String(rec.type ?? '?')
          if (typeof pos.endOffset === 'number') {
            expect(
              pos.endOffset,
              `${type} endOffset past document in ${name}`,
            ).toBeLessThanOrEqual(bound)
          }
          if (typeof pos.startOffset === 'number') {
            expect(
              pos.startOffset,
              `${type} startOffset negative in ${name}`,
            ).toBeGreaterThanOrEqual(0)
          }
          if (typeof pos.startOffset === 'number' && typeof pos.endOffset === 'number') {
            expect(pos.endOffset, `${type} span reversed in ${name}`).toBeGreaterThanOrEqual(
              pos.startOffset,
            )
          }
          if (typeof pos.startColumn === 'number') {
            expect(
              pos.startColumn,
              `${type} startColumn below 1 in ${name}`,
            ).toBeGreaterThanOrEqual(1)
          }
        }
        for (const key of Object.keys(rec)) {
          if (key === 'pos') continue
          const value = rec[key]
          if (Array.isArray(value)) value.forEach(walk)
          else if (value && typeof value === 'object') walk(value)
        }
      }
      walk(doc)

      const findCode = (node: unknown): Record<string, unknown> | undefined => {
        if (!node || typeof node !== 'object') return undefined
        const rec = node as Record<string, unknown>
        if (rec.type === 'code_block' && rec.pos) return rec
        for (const key of Object.keys(rec)) {
          const found = findCode(rec[key])
          if (found) return found
        }
        return undefined
      }
      const code = findCode(doc)
      if (code) {
        const pos = code.pos as { startOffset: number; endOffset: number }
        const slice = buf.slice(pos.startOffset, pos.endOffset).toString('utf8')
        // Slices back to real source (the frame never reaches an offset), and
        // ends on its last body line rather than past the document.
        expect(slice).not.toContain('\u0000')
        expect(slice.length).toBeGreaterThan(0)
        expect(pos.endOffset).toBeLessThanOrEqual(bound)
      }
    })
  }
})
