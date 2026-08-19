import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.js'

/*
 * THE CLOSER INDEX HAS TO ANSWER FOR THE SAME FENCE THE MATCHER DOES.
 *
 * That is the invariant this file exists for, and it has now been broken in
 * BOTH directions, which is why the rows below moved once already.
 *
 * carve-js#1121 narrowed the code fence's trailing run to `space` at both ends
 * and `RE_ANY_FENCE_CLOSER` kept `[ \t]*$`, so the index recorded closers the
 * matcher rejected. carve#1295 then split the rule by POSITION - a tab before
 * content is a separator, a tab at end of line is trailing - and a CLOSER TAKES
 * NO CONTENT AFTER ITS MARKER, so its tab is always trailing and the fence
 * closes. carve-js#1132 widened the matcher back at the closer only, and this
 * index with it.
 *
 * WHICH DIRECTION THE INDEX ERRS IN IS NOT SYMMETRIC, because
 * `codeCloserPossible` only ever REFUTES:
 *
 *   index WIDER than the matcher   ->  a wasted scan. Slow, still correct.
 *   index NARROWER than it         ->  a WRONG answer.
 *
 * Too wide cost the quadratic path this index was built to close: a candidate
 * the real matcher rejects turns "no closer ahead" into "go and scan", and the
 * scan runs to the end of the document every time.
 *
 * Too narrow is worse than slow. An opener is told no closer exists and
 * swallows the rest of the document past a closer that is really there - and
 * an item's tight/loose decision, which skips the blanks inside a fence, counts
 * a blank that is really code.
 *
 * So this pattern follows the matcher whenever the matcher WIDENS, and may lag
 * it only when it narrows. Expected output measured byte-exact against
 * carve-php.
 */

describe('a fence line ending in a tab is not a closer candidate either', () => {
  it('the tab-padded closer CLOSES, and the item is still tight', () => {
    // The shape the original divergence was found on, now read under
    // carve#1295. The only blank sits inside the ``` fence and the ```<TAB>
    // below it DOES close it, so the blank is fence content either way and the
    // item stays tight - but the delimiter line is no longer part of the code.
    //
    // The index has to record that line as a candidate for this to hold: were
    // it narrow, the pass would be told no closer is ahead and would count the
    // blank as an item separator.
    expect(carveToHtml('- a\n+\n::: note\n```\n\n```\t\n:::\n- b\n')).toBe(
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

  it('reads the same for a tilde fence, and for a trailing space-then-tab', () => {
    // A SECOND delimiter character and a trailing run that STARTS with a space,
    // so a fix that only looked at a lone tab does not pass.
    expect(carveToHtml('- a\n+\n::: note\n~~~\n\n~~~ \t\n:::\n- b\n')).toBe(
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
    // Kept from when the tail could not close, and it still guards the same
    // path from the other side. Under carve#1295 the ```<TAB> line DOES close,
    // so the first opener consumes the rest as its content and the run is read
    // once - linear. Were the index to disagree with the matcher again in
    // either direction, this shape is where the cost shows: pre-fix it read
    // ~4x per byte at a 4x size multiple, against ~1x here.
    expectBuiltInputScansLinearly(
      (input) => void carveToHtml(input),
      (repeats) => '- a\n+\n::: note\n' + '```js\n'.repeat(repeats) + '```\t\n:::\n- b\n',
      { label: 'code openers under a tab-terminated line', smallRepeats: 2_000 },
    )
  })
})
