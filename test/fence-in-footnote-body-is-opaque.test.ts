import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * A code fence is opaque. A definition-shaped line inside one is a code SAMPLE,
 * and registers nothing.
 *
 * This engine knew that everywhere except a footnote body. The definition prepass
 * re-bases a fence opener on the enclosing CONTENT COLUMN, and `contentCol`
 * tracks list items only - so inside a note body it was 0, the indented opener
 * matched nothing, the fence went untracked, and the line inside it was collected
 * as a real definition. A reference below the note then resolved against a code
 * sample (carve-js#667).
 *
 * The executable spec and carve-rs both decline it; carve-php had the same bug
 * (carve-php#811).
 */

const resolves = (src: string) => carveToHtml(src).includes('href="/u"')

describe('a code fence inside a footnote body is opaque', () => {
  it('does not register a link definition written in it', () => {
    const src = '[^a]: note\n  ```\n  [r]: /u\n  ```\n\nsee[^a] and [t][r]\n'

    expect(resolves(src)).toBe(false)
    // The reference stays literal, and the code line still renders as code.
    expect(carveToHtml(src)).toContain('[t][r]')
    expect(carveToHtml(src)).toContain('<pre><code>')
  })

  it('does not register a footnote definition written in it either', () => {
    // Passes on the parent commit too: the FOOTNOTE prepass already treats the
    // fence as opaque, and only the LINK-definition prepass had the gap. Kept as
    // the invariant either way, not as evidence of the fix.
    const src = '[^a]: note\n  ```\n  [^b]: inner\n  ```\n\nsee[^a] and see[^b]\n'

    // `[^b]` was never defined, so it cannot become a note reference.
    expect(carveToHtml(src)).toContain('see[^b]')
  })

  it('still collects a definition written OUTSIDE the fence in the same body', () => {
    // The boundary: the fix must not make the whole note body opaque.
    const src = '[^a]: note\n  [r]: /u\n\nsee[^a] and [t][r]\n'

    expect(resolves(src)).toBe(true)
  })

  it('reopens collection after the fence closes', () => {
    const src = '[^a]: note\n  ```\n  x\n  ```\n\n  [r]: /u\n\nsee[^a] and [t][r]\n'

    expect(resolves(src)).toBe(true)
  })
})

describe('the containers that already declined it still do', () => {
  it('top level', () => {
    expect(resolves('```\n[r]: /u\n```\n\n[t][r]\n')).toBe(false)
  })

  it('inside a block quote', () => {
    expect(resolves('> ```\n> [r]: /u\n> ```\n\n[t][r]\n')).toBe(false)
  })

  it('inside a list item', () => {
    expect(resolves('- ```\n  [r]: /u\n  ```\n\n[t][r]\n')).toBe(false)
  })
})
