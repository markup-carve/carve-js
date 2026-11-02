import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// Ruling B on markup-carve/carve#4770: a `%%%` opener with an exact-width closer
// ahead opens a span even when a body line misses its owner first. That line ends
// the span (PART 0 S1) and is read in its own owner, never as lazy text.
const html = (source: string) => carveToHtml(source).replace(/\s+</g, '<').replace(/>\s+/g, '>').trim()

describe('a closer ahead opens a child comment span past an owner miss', () => {
  it.each([
    ['. a\n  . %%%\n    n\n>>\n%%%\n', '<ol><li>a<ol><li>n</li></ol></li></ol><p>&gt;&gt;</p>'],
    ['- a\n  - %%%\n    n\nzz\n    %%%\n', '<ul><li>a<ul><li>n</li></ul></li></ul><p>zz</p>'],
    ['1. a\n   . %%%\n     n\n  zz\n%%%\n', '<ol><li>a<ol><li>n</li></ol></li></ol><p>zz</p>'],
    // A line that misses only the child lands in the outer item.
    ['. a\n  . %%%\n    n\n  zz\n%%%\n', '<ol><li>a<ol><li>n</li></ol>zz</li></ol>'],
    // With no closer ahead the opener is a `%%` line and the line folds.
    ['. a\n  . %%%\n    n\n>>\n', '<ol><li>a<ol><li>n\n&gt;&gt;</li></ol></li></ol>'],
  ])('%j', (source, expected) => expect(html(source)).toBe(expected))
})
