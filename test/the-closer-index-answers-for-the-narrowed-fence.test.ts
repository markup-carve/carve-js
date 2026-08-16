import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.js'

/*
 * THE CLOSER INDEX HAS TO ANSWER FOR THE SAME FENCE THE MATCHER DOES.
 *
 * carve-js#1121 narrowed the code fence's trailing run to `space`, so a
 * ` ```<TAB> ` line is no longer a closer. `RE_ANY_FENCE_CLOSER`, the pattern
 * that builds the lookahead index, kept `[ \t]*$` and went on recording those
 * lines as candidate closers.
 *
 * The index is documented as a SUPERSET, which is true of its LEADING run: a
 * caller may read a dedented view of the same lines, so tolerating leading
 * whitespace keeps "no closer ahead" valid for every view. The TRAILING run is
 * not that. Dedenting only ever strips leading whitespace, so no view can turn
 * a tab-terminated line into a code closer, and recording it as one is simply
 * an answer that is wrong in the one direction the callers act on.
 *
 * It cost both halves.
 *
 *  - CORRECTNESS. An item's tight/loose decision skips the blanks inside a
 *    fence. With the index claiming a closer might be ahead, the scan behaved
 *    as though the fence could still close and the blank counted, so the item
 *    came out LOOSE where carve-rs reads it TIGHT. 48 documents over a small
 *    generated set of fence/tail/wrapper combinations differed, and carve-rs
 *    agreed with the narrowed index on all 48 and with the wide one on none.
 *
 *  - COST. `codeCloserPossible` exists so an unterminated opener does not
 *    re-read the whole suffix. A candidate the real matcher rejects turns
 *    "no closer ahead" into "go and scan", and the scan then runs to the end
 *    of the document every time - the quadratic path the index was built to
 *    close.
 *
 * Expected output measured byte-exact against carve-rs.
 */

describe('a fence line ending in a tab is not a closer candidate either', () => {
  it('leaves the item TIGHT, because the blank is inside an unterminated fence', () => {
    // The shape the divergence was found on. The only blank sits inside the
    // ``` fence, and the ```<TAB> below it does not close it - so the blank is
    // fence content, not a separator, and the item is tight.
    expect(carveToHtml('- a\n+\n::: note\n```\n\n```\t\n:::\n- b\n')).toBe(
      '<ul>\n' +
        '  <li>a\n' +
        '    <aside class="admonition note">\n' +
        '      <pre><code>\n' +
        '```\t\n' +
        '</code></pre>\n' +
        '    </aside>\n' +
        '  </li>\n' +
        '  <li>b</li>\n' +
        '</ul>',
    )
  })

  it('reads the same for a tilde fence, and for a trailing space-then-tab', () => {
    // A SECOND delimiter character and a trailing run that STARTS with a space,
    // so a fix that only looked at a lone tab does not pass.
    expect(carveToHtml('- a\n+\n::: note\n~~~\n\n~~~ \t\n:::\n- b\n')).toBe(
      '<ul>\n' +
        '  <li>a\n' +
        '    <aside class="admonition note">\n' +
        '      <pre><code>\n' +
        '~~~ \t\n' +
        '</code></pre>\n' +
        '    </aside>\n' +
        '  </li>\n' +
        '  <li>b</li>\n' +
        '</ul>',
    )
  })

  it('CONTROL: a real closer still closes, and the item is still tight', () => {
    // Without this the class could be emptied - an index that recorded NOTHING
    // would pass every row above and break every document that closes.
    expect(carveToHtml('- a\n+\n::: note\n```\n\n```\n:::\n- b\n')).toBe(
      '<ul>\n' +
        '  <li>a\n' +
        '    <aside class="admonition note">\n' +
        '      <pre><code>\n' +
        '</code></pre>\n' +
        '    </aside>\n' +
        '  </li>\n' +
        '  <li>b</li>\n' +
        '</ul>',
    )
  })

  it('CONTROL: the colon closer keeps the wider run, so a tab still closes a div', () => {
    // carve#1285 moved the CODE fence's row and no other. carve-rs accepts a
    // tab after `:::`, and the index for it must go on accepting one - a sweep
    // that narrowed every closer pattern together would fail here.
    expect(carveToHtml('- a\n+\n::: div\n\n:::\t\n- b\n')).toBe(
      '<ul>\n' +
        '  <li>a\n' +
        '    <div class="div">\n' +
        '\n' +
        '    </div>\n' +
        '  </li>\n' +
        '  <li>b</li>\n' +
        '</ul>',
    )
  })

  it('CONTROL: the comment closer keeps it too', () => {
    expect(carveToHtml('- a\n+\n::: note\n%%%\n\nx\n%%%\t\n:::\n- b\n')).toBe(
      '<ul>\n' +
        '  <li>a\n' +
        '    <aside class="admonition note">\n' +
        '\n' +
        '    </aside>\n' +
        '  </li>\n' +
        '  <li>b</li>\n' +
        '</ul>',
    )
  })

  perfIt('does not send every opener on a scan to end of document', () => {
    // The units must DIFFER in the general case for this shape to be quadratic,
    // but here they need not: none of them can close, so each one scans the
    // whole suffix. Pre-fix this read ~4x per byte at a 4x size multiple; the
    // narrowed index puts it back at ~1x.
    expectBuiltInputScansLinearly(
      (input) => void carveToHtml(input),
      (repeats) => '- a\n+\n::: note\n' + '```js\n'.repeat(repeats) + '```\t\n:::\n- b\n',
      { label: 'code openers under a tab-terminated line', smallRepeats: 2_000 },
    )
  })
})
