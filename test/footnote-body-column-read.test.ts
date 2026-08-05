import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * Reading side of the footnote body column: the body's own column is TWO, fixed
 * by §16 (`space, space, {whitespace}`), NOT whatever the first continuation
 * line happens to carry.
 *
 * This engine took it from the first continuation line, so a body written at
 * three saw its blocks at relative column zero and an indented table opened a
 * table. The executable spec, carve-rs and carve-php all dedent by two, leaving
 * one residual column, at which an opener is lazy text instead - a 3-to-1
 * divergence, and this engine was the one (carve-js#677).
 *
 * Why it survived: the leniency is invisible to a round trip. Once the writer
 * moved to two (carve-js#676) every `carveToCarve` output was a form this
 * parser reads the same way as everyone else, so nothing here could fail. The
 * discriminating input is a body a HUMAN wrote at three - which no generated
 * fixture produces.
 *
 * The `at three` half of each pair is therefore the load-bearing assertion. Both
 * halves are kept together so a fix that simply hard-strips all leading
 * whitespace - passing the three-space half by flattening it - fails the two.
 */

/** Each shape at the body's own column, and the same shape one column in. */
const SHAPES: Array<{ name: string; opens: string; folds: string; probe: RegExp }> = [
  {
    name: 'table',
    opens: '  | a |\n  | - |\n  | b |\n',
    folds: '   | a |\n   | - |\n   | b |\n',
    probe: /<table>/,
  },
  { name: 'block quote', opens: '  > q\n', folds: '   > q\n', probe: /<blockquote>/ },
  {
    name: 'code fence',
    opens: '  ```\n  code\n  ```\n',
    folds: '   ```\n   code\n   ```\n',
    probe: /<pre>/,
  },
  { name: 'heading', opens: '  ## h\n', folds: '   ## h\n', probe: /<h2/ },
  { name: 'div', opens: '  :::\n  body\n  :::\n', folds: '   :::\n   body\n   :::\n', probe: /<div>/ },
]

const document = (body: string): string => `[^a]: intro\n\n${body}\nsee[^a]\n`

describe('a footnote body is read at its own column', () => {
  it('opens a block at two', () => {
    for (const { name, opens, probe } of SHAPES) {
      expect(carveToHtml(document(opens)), name).toMatch(probe)
    }
  })

  it('does not open one at three', () => {
    for (const { name, folds, probe } of SHAPES) {
      const html = carveToHtml(document(folds))
      expect(html, name).not.toMatch(probe)
      // Present as text, not dropped: the residual column makes it a paragraph.
      expect(html, name).toContain('<p>')
    }
  })

  it('reads the column from §16, not from the first continuation line', () => {
    // The whole body sits at four, so the first line cannot be what sets the
    // column - under the old reading every row landed at relative zero and this
    // was a table. Two residual columns, so it is a paragraph.
    const html = carveToHtml(document('    | a |\n    | - |\n    | b |\n'))
    expect(html).not.toMatch(/<table>/)
    expect(html).toContain('| a |')
  })

  it('keeps a narrower line after a wider one attached', () => {
    // Widest first, then the minimum: the body still ends at the definition, and
    // both lines fold into the one paragraph rather than the narrow line
    // becoming a sibling block.
    const html = carveToHtml('[^a]: first\n     wide\n  narrow\n\nsee[^a]\n')
    expect(html).toContain('first\nwide\nnarrow')
  })

  it('still lets the body read its own deeper indentation', () => {
    // Two is the body's floor, not a ceiling: a nested list's inner item is at
    // four and must still nest.
    const html = carveToHtml(document('  - one\n    - deep\n'))
    expect(html).toMatch(/<ul>[\s\S]*<ul>/)
    expect(html).toContain('deep')
  })

  it('agrees with a list item at the same relative column', () => {
    // §16's body and §24's item body are the same rule read twice, so an opener
    // one column above the content column has to behave the same in both.
    const inNote = carveToHtml(document('   > q\n'))
    const inItem = carveToHtml('- a\n\n   > q\n')
    expect(inNote).not.toMatch(/<blockquote>/)
    expect(inItem).not.toMatch(/<blockquote>/)
  })
})
