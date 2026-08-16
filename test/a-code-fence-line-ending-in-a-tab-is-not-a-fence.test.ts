import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// markup-carve/carve#1285, carve-js#1121.
//
// `resources/grammar.ebnf`, at `abbreviation_definition`, is NORMATIVE about
// the marker separator: it is the `space` terminal (U+0020) ONLY, "a tab does
// NOT satisfy `space` (`space = ' '`)", and this "mirrors the heading, list and
// task markers, which likewise require a literal space after the marker".
// carve-rs is named as the reference there.
//
// The fence line is the one member of that family the sentence does not
// enumerate, which is why it drifted: the trailing run on a ` ``` ` / `~~~`
// line was spelled `[ \t]*$`, so a fence line ending in a tab opened a code
// block here and in carve-php while carve-rs read the run as prose.
//
// OPENER AND CLOSER ARE ONE RUN SEEN FROM TWO ENDS (carve-js#805), so both ends
// move together. carve-rs refuses the tab at both: a `\`\`\`<TAB>` line neither
// opens a block nor closes one, and as a closer it stays in the block as
// content.
//
// SCOPE. Only the backtick/tilde family moves. carve-rs accepts a tab after
// `:::`, after `+` and after `%%%`, and this engine already agreed with it on
// all three; those rows are asserted below as controls so a later sweep cannot
// widen the narrowing past what carve#1285 ruled.
//
// Every expected string below was measured against carve-rs `9b0bc779`, built
// from a clean checkout.

const TAB = '\t'

describe('a code fence line ending in a tab is not a fence', () => {
  it('refuses the opener: the run is prose, and the unclosed span reaches the end of the block', () => {
    expect(carveToHtml('```' + TAB + '\nx\n')).toBe('<p><code>\nx</code></p>')
  })

  it('refuses the opener when an info token follows the tab', () => {
    expect(carveToHtml('```' + TAB + 'php\nx\n```\n')).toBe(
      '<p><code>' + TAB + 'php\nx\n</code></p>',
    )
  })

  it('refuses a tilde opener ending in a tab', () => {
    expect(carveToHtml('~~~' + TAB + '\nx\n')).toBe('<p>~~~\nx</p>')
  })

  it('refuses the raw-block opener ending in a tab', () => {
    expect(carveToHtml('```=html' + TAB + '\n<b>x</b>\n```\n')).toBe(
      '<p><code>=html\n&lt;b&gt;x&lt;/b&gt;\n</code></p>',
    )
  })

  it('refuses the closer: the delimiter line stays in the block as content', () => {
    expect(carveToHtml('```\nx\n```' + TAB + '\n')).toBe(
      '<pre><code>x\n```' + TAB + '\n</code></pre>',
    )
  })

  it('refuses a tilde closer ending in a tab', () => {
    expect(carveToHtml('~~~\nx\n~~~' + TAB + '\n')).toBe(
      '<pre><code>x\n~~~' + TAB + '\n</code></pre>',
    )
  })

  // The controls. A SPACE satisfies the same run at both ends, so the fix is
  // about the tab and not about trailing whitespace in general.
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
      '<aside class="admonition note">\n  <p>x</p>\n</aside>',
    )
  })

  it('the comment fence still opens and closes on a tab', () => {
    expect(carveToHtml('%%%' + TAB + '\nhidden\n%%%' + TAB + '\ny\n')).toBe('<p>y</p>')
  })
})
