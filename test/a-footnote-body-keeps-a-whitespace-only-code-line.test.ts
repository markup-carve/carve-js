import { describe, expect, it } from 'vitest'

import { carveToHtml } from '../src/index.js'

/*
 * A WHITESPACE-ONLY CODE LINE IN A FOOTNOTE BODY KEEPS ITS CONTENT
 * (markup-carve/carve#2420). No new ruling: CARVE-P11-016's "THE PARSER KEEPS
 * THAT CONTENT" is stated for any container, and markup-carve/carve#2403
 * settled it. The engine fixes for it reached the list-item collectors only.
 *
 * The footnote collector read a whitespace-only line inside a fenced block as a
 * blank and buffered it as the empty string, so everything past the body's
 * indent was dropped.
 *
 * The restore runs AFTER the body is rebased, and it has to: the S4 tracker
 * reads a fence FLUSH, and the rebase is what brings an authored base flush. A
 * body written past its two-column minimum, which is the shape the ticket
 * reports, never showed the tracker a fence at all. The residue is measured past
 * the opener's own source column, the column the code block's content is
 * measured past.
 */

/** The content of the first fenced code block in the rendered document. */
const code = (source: string): string => {
  const match = /<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/.exec(carveToHtml(source))
  if (!match) throw new Error(`no code block in the render of ${JSON.stringify(source)}`)
  return match[1]!
}

const note = (body: string): string => `x[^1]\n\n[^1]: note\n\n${body}\n`

describe('a footnote body keeps a whitespace-only code line', () => {
  it('keeps the residue when the body sits past its minimum column', () => {
    // The ticket's own repro. The middle line holds six spaces and the code is
    // written at column four, so two spaces are content.
    expect(code(note('    ```\n    a\n      \n    b\n    ```'))).toBe('a\n  \nb\n')
  })

  it('keeps the residue when the body sits AT its minimum column', () => {
    expect(code(note('  ```\n  a\n    \n  b\n  ```'))).toBe('a\n  \nb\n')
  })

  it('keeps the residue inside a tilde fence', () => {
    expect(code(note('    ~~~\n    a\n      \n    b\n    ~~~'))).toBe('a\n  \nb\n')
  })

  it('keeps a tab as the residue', () => {
    expect(code(note('    ```\n    a\n    \t\n    b\n    ```'))).toBe('a\n\t\nb\n')
  })

  it('keeps one residue per line across a run of them', () => {
    expect(code(note('    ```\n    a\n      \n       \n    b\n    ```'))).toBe('a\n  \n   \nb\n')
  })
})

describe('what the restore must NOT touch', () => {
  it('leaves a truly empty line empty', () => {
    expect(code(note('    ```\n    a\n\n    b\n    ```'))).toBe('a\n\nb\n')
  })

  it('leaves a line whose whitespace stops short of the code column empty', () => {
    // Two spaces under a fence at column four is nothing past the opener.
    expect(code(note('    ```\n    a\n  \n    b\n    ```'))).toBe('a\n\nb\n')
  })

  it('leaves a whitespace-only line OUTSIDE a fence separating two blocks', () => {
    // Without an open verbatim region the line is a separator, and keeping its
    // spaces would make it a content line the body never had.
    const html = carveToHtml('x[^1]\n\n[^1]: a\n      \n    b\n')
    expect(html).toContain('<p>a</p>')
    expect(html).not.toContain('<pre>')
  })
})

describe('the list-item control', () => {
  it('still keeps the residue at the item content column', () => {
    // markup-carve/carve-js#2166 landed this. It is here so a regression in the
    // shared tracker shows up against a container this change did not touch.
    expect(code('- item\n\n  ```\n  a\n    \n  b\n  ```\n')).toBe('a\n  \nb\n')
  })
})
