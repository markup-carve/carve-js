import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

/**
 * `fmt` writes a footnote body at TWO spaces, the body's own column.
 *
 * The writer used THREE. Three is legal continuation - §16 is
 * `space, space, {whitespace}` - but a reader that takes the body's own column as
 * two then sees the body's blocks at a relative column ABOVE zero, and an
 * indented block opener does not open a block. So a table in a note body came
 * back as a paragraph.
 *
 * THIS ENGINE'S ROUND TRIP PASSED THE WHOLE TIME. Its parser accepts blocks at
 * three, so `carveToHtml(carveToCarve(x))` agreed with itself on a form the
 * executable spec, carve-rs and carve-php all read differently. Measured on the
 * three-space output: the oracle, carve-rs and carve-php read a paragraph; only
 * this engine read a table. Self-consistency is not portability.
 *
 * So the assertion that discriminates here is the OUTPUT COLUMN, not the round
 * trip. That is unusual enough to say out loud: the property you would reach for
 * first is exactly the one that cannot fail in this repo.
 *
 * The stronger check - re-read the writer's output with the ORACLE and compare -
 * cannot live here without adding `ohm-js` as a devDependency, since both
 * `spec/scripts/spec/layout.mjs` and `html.mjs` need it. It belongs in the
 * corpus-wide gate instead (carve#710), which today only ever asks the writing
 * engine to read its own output - which is precisely why nothing caught this.
 *
 * Whether this engine SHOULD accept three is separate and still open
 * (carve-js#677); nothing here pins that leniency, so fixing it will not fight
 * these assertions.
 *
 * carve-js#676. Same one-line change in carve-php#824 and carve-rs#618.
 */

/** Every block shape a note body can hold, indented at the body's own column. */
const SHAPES: Array<[string, string]> = [
  ['table', '  | a |\n  | - |\n  | b |\n'],
  ['code fence', '  ```\n  code\n  ```\n'],
  ['block quote', '  > quoted\n'],
  ['heading', '  # H\n'],
  ['div', '  :::\n  body\n  :::\n'],
  ['nested list', '  - one\n    - deep\n'],
  ['definition list', '  :: term\n  :  def\n'],
  // These two round-tripped at three spaces in every engine - a bullet opens a
  // list at any indent, which is a large part of why the bug survived. Kept so a
  // narrowed fix still has to keep them working.
  ['bullet list', '  - one\n  - two\n'],
  ['second paragraph', '  second para\n'],
]

const document = (body: string): string => `[^a]: intro\n\n${body}\nsee[^a]\n`

describe('the footnote body column', () => {
  it('is two spaces, not three', () => {
    // The MINIMUM is the claim. Lines deeper than that are the body's own blocks
    // reading their own indentation - a nested list's inner item belongs at four.
    for (const [name, body] of SHAPES) {
      const out = carveToCarve(document(body))
      const indents = out
        .split('\n')
        .filter((l) => l.startsWith(' '))
        .map((l) => l.length - l.replace(/^ +/, '').length)
      expect(Math.min(...indents), `${name}: ${JSON.stringify(out)}`).toBe(2)
    }
  })

  it('puts the body under the definition, not beside it', () => {
    // A second reading of the same output, so the test is not one regex: the
    // definition opens at column zero and every body line is indented under it.
    const out = carveToCarve(document('  | a |\n  | - |\n  | b |\n'))
    const lines = out.split('\n').filter((l) => l.trim())
    const def = lines.findIndex((l) => l.startsWith('[^a]:'))
    expect(def).toBeGreaterThanOrEqual(0)
    // Exactly two, not "at least two" - a table's rows are all at the body's own
    // column, so a laxer assertion here would pass on the three-space output too
    // and this test would only be restating the one above.
    for (const line of lines.slice(def + 1)) {
      expect(line.startsWith('  ') && !line.startsWith('   '), JSON.stringify(line)).toBe(true)
    }
  })

  it('still round-trips through this engine', () => {
    // Weaker than it looks - see the note above, it passed on three spaces too -
    // and kept anyway, because it is the property the writer is nominally for.
    for (const [name, body] of SHAPES) {
      const src = document(body)
      expect(carveToHtml(carveToCarve(src)), name).toBe(carveToHtml(src))
    }
  })

  it('leaves an inline-only body alone', () => {
    // No continuation lines, so nothing to indent. The shape most notes use.
    const src = '[^a]: just text\n\nsee[^a]\n'
    expect(carveToCarve(src)).toContain('[^a]: just text')
    expect(carveToCarve(src)).not.toMatch(/\n {3}/)
  })

  it('keeps a wrapped inline body attached', () => {
    // A plain continuation line, never broken: it must stay part of the body
    // rather than becoming a sibling paragraph.
    const src = '[^a]: one\n  two\n\nsee[^a]\n'
    expect(carveToHtml(carveToCarve(src))).toBe(carveToHtml(src))
    expect(carveToHtml(carveToCarve(src))).toContain('one\ntwo')
  })
})
