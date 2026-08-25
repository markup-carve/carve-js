import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * The body starts at §16's minimum column of two. A structural opener at that
 * column or farther in establishes its authored local block base (carve#1729),
 * matching the container rule introduced for list items by carve#1705.
 */

/** Each shape at the minimum column, and the same shape one column in. */
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

  it('opens one at an authored base past the minimum', () => {
    for (const { name, folds, probe } of SHAPES)
      expect(carveToHtml(document(folds)), name).toMatch(probe)
  })

  it('accepts an authored base several columns past the minimum', () => {
    const html = carveToHtml(document('    | a |\n    | - |\n    | b |\n'))
    expect(html).toMatch(/<table>/)
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
    // §16's body and §24's item body apply the same authored-base rule.
    const inNote = carveToHtml(document('   > q\n'))
    const inItem = carveToHtml('- a\n\n   > q\n')
    expect(inNote).toMatch(/<blockquote>/)
    expect(inItem).toMatch(/<blockquote>/)
  })
})
