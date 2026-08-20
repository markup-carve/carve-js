import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// markup-carve/carve#1285, then markup-carve/carve#1295, which superseded it in
// part. carve-js#1121, #1123, #1128, #1132.
//
// POSITION DECIDES, NOT THE CONSTRUCT. `resources/grammar.ebnf`, at
// `abbreviation_definition`, is NORMATIVE about the marker separator: it is the
// `space` terminal (U+0020) ONLY, "a tab does NOT satisfy `space`
// (`space = ' '`)", and this "mirrors the heading, list and task markers, which
// likewise require a literal space after the marker". carve#1285 added the
// fence line, which that sentence had not enumerated.
//
// WHAT THAT CLAUSE GOVERNS IS A SEPARATOR - whitespace standing BETWEEN a
// marker and content on the same line. It says nothing about a line ENDING, and
// PART 2 drops trailing whitespace before any of this is asked. This file was
// first written under the reading that OPENER AND CLOSER ARE ONE RUN SEEN FROM
// TWO ENDS (carve-js#805), and so asserted that a fence line ending in a tab is
// never a fence, at either end. carve#1295 split that by position, and three of
// these rows moved:
//
//   ```<TAB>php   content follows  ->  separator  ->  does NOT open
//   ```<TAB>       nothing follows  ->  trailing   ->  opens
//   ```php<TAB>    content precedes ->  trailing   ->  opens
//   ```<TAB>       as a CLOSER      ->  trailing   ->  closes
//
// Only the first row survives from the original reading, and it is the row the
// separator clause actually governs. The file's title is kept for continuity
// with the tickets; what it asserts is the split.
//
// SCOPE. Only the backtick/tilde family was ever in question. A tab after
// `:::`, after `+` and after `%%%` was always accepted, and those rows are
// asserted below as controls so a later sweep cannot move them either.
//
// carve-php is the reference for the position split and every expected string
// below was measured against it at `8a9dc5c`.

const TAB = '\t'

describe('a code fence line ending in a tab is not a fence', () => {
  // THE ONE ROW THE SEPARATOR CLAUSE GOVERNS, and the only one that did not
  // move: content follows the tab, so the tab stands between marker and info
  // and cannot be `space`. The run is prose.
  it('refuses the opener when an info token follows the tab', () => {
    expect(carveToHtml('```' + TAB + 'php\nx\n```\n')).toBe(
      '<p><code>' + TAB + 'php\nx\n</code></p>',
    )
  })

  it('refuses the raw-block opener when the format follows the tab', () => {
    expect(carveToHtml('```' + TAB + '=html\n<b>x</b>\n```\n')).toBe(
      '<p><code>' + TAB + '=html\n&lt;b&gt;x&lt;/b&gt;\n</code></p>',
    )
  })

  // THE OPENER'S TRAILING ROWS WENT THE OTHER WAY (carve#1295). Nothing follows
  // the tab, so it is trailing whitespace, PART 2 drops it, and the fence opens
  // as an ordinary one. These three asserted the opposite.
  it('opens when the tab is trailing and nothing follows it', () => {
    expect(carveToHtml('```' + TAB + '\nx\n```\n')).toBe('<pre><code>x\n</code></pre>')
  })

  it('opens a tilde opener ending in a tab', () => {
    expect(carveToHtml('~~~' + TAB + '\nx\n~~~\n')).toBe('<pre><code>x\n</code></pre>')
  })

  it('opens the raw block when the tab TRAILS the format', () => {
    // The other side of the raw-fence pair above: here the tab comes after the
    // format token rather than before it.
    expect(carveToHtml('```=html' + TAB + '\n<b>x</b>\n```\n')).toBe('<b>x</b>')
  })

  it('opens when the tab trails an info string', () => {
    // `` ```php<TAB> `` - content PRECEDES the tab, so it is trailing and the
    // info string is still read.
    expect(carveToHtml('```php' + TAB + '\nx\n```\n')).toBe(
      '<pre><code class="language-php">x\n</code></pre>',
    )
  })

  // THE CLOSER, which has no content after its marker and so can only ever be
  // trailing. These two rows asserted refusal as well.
  it('closes the closer: a tab after the marker is trailing, not a separator', () => {
    expect(carveToHtml('```\nx\n```' + TAB + '\n')).toBe('<pre><code>x\n</code></pre>')
  })

  it('closes a tilde closer ending in a tab', () => {
    expect(carveToHtml('~~~\nx\n~~~' + TAB + '\n')).toBe('<pre><code>x\n</code></pre>')
  })

  // The controls. A SPACE always satisfied the trailing run at both ends, so
  // these pin that the position split did not disturb it.
  it('a space keeps the opener', () => {
    expect(carveToHtml('``` \nx\n')).toBe('<pre><code>x\n</code></pre>')
  })

  it('a space keeps the closer', () => {
    expect(carveToHtml('```\nx\n``` \n')).toBe('<pre><code>x\n</code></pre>')
  })

  it('a bare fence with nothing after the run is unaffected', () => {
    expect(carveToHtml('```\nx\n```\n')).toBe('<pre><code>x\n</code></pre>')
  })

  // The constructs the ruling did NOT move. carve-rs accepts a tab on each.
  it('the colon fence still closes on a tab', () => {
    expect(carveToHtml('::: note\nx\n:::' + TAB + '\n')).toBe(
      '<aside class="admonition note" aria-label="Note">\n  <p>x</p>\n</aside>',
    )
  })

  it('the comment fence still opens and closes on a tab', () => {
    expect(carveToHtml('%%%' + TAB + '\nhidden\n%%%' + TAB + '\ny\n')).toBe('<p>y</p>')
  })
})
