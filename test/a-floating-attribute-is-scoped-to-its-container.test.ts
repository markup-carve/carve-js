import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * PART 9 §15 A2 says a pending `{...}` applies to the next BLOCK. That answers
 * which block, not which CONTAINER, and containment bounds everything else in
 * the language - so an attribute written inside a quote, an item or a `dd` does
 * not survive that container's end (markup-carve/carve#1281, corpus category
 * 329).
 *
 * Two gaps here, and the document in the corpus needs both:
 *
 *  - the QUOTE's tracker had no attribute-line branch at all, where the item's
 *    has had one all along, so `> q` / `> {.k}` / `tail` kept the flush-left
 *    line inside the quote and classed it;
 *  - a WRAPPED block (§15 A5) was invisible to both trackers, because the only
 *    predicate they had answers for the single-line form. `{.k` / `#x}` read as
 *    two lines of prose: the author's braces reached the page and the
 *    attributes reached nothing.
 *
 * carve-rs `b6ff319c` produces every expectation below except the four marked
 * as its own residual gap.
 */
const norm = (html: string) => html.replace(/>\n\s*/g, '>').replace(/\n\s*</g, '<')

describe('a floating attribute is scoped to the container that holds it', () => {
  it('does not escape a quote onto a document-level paragraph', () => {
    // It composes with S4: the attribute leaves no open paragraph, so the
    // flush-left line ends the quote rather than joining it, and A4 then has
    // nothing left to attach to.
    expect(carveToHtml('> q\n> {.k}\ntail\n')).toBe(
      '<blockquote><p>q</p></blockquote>\n<p>tail</p>',
    )
  })

  it('answers the same across a blank line', () => {
    expect(carveToHtml('> q\n> {.k}\n\ntail\n')).toBe(
      '<blockquote><p>q</p></blockquote>\n<p>tail</p>',
    )
  })

  it('a WRAPPED block is one block, and ends a definition body', () => {
    expect(carveToHtml(':: t\n:  d\n   {.k\n   #x}\ntail\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>d</dd>\n</dl>\n<p>tail</p>',
    )
    // The single-line spelling of the same document, which already answered
    // this way. The two must not differ.
    expect(carveToHtml(':: t\n:  d\n   {.k}\ntail\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>d</dd>\n</dl>\n<p>tail</p>',
    )
  })

  it('a WRAPPED block ends an item and a quote the same way', () => {
    expect(carveToHtml('- a\n  {.k\n  #x}\ntail\n')).toBe(
      '<ul>\n  <li>a</li>\n</ul>\n<p>tail</p>',
    )
    // carve-rs still attaches this one FORWARD out of the quote, which is the
    // answer its own single-line reading rejects; §15 A5 makes one block one
    // block however many lines it takes, so the two spellings agree here.
    expect(norm(carveToHtml('> q\n> {.k\n> #x}\ntail\n'))).toBe(
      norm(carveToHtml('> q\n> {.k}\ntail\n')),
    )
  })

  // AN OPEN RUN IS STILL PROSE. A `{` with no `}` after it anywhere is not a
  // block at all, so it holds the paragraph its lines are - a tracker that
  // treated the opener as decisive closed containers on documents with no
  // attribute block in them.
  it('an unterminated brace run holds its paragraph open', () => {
    expect(carveToHtml('- a\n  {.k\ntail\n')).toBe('<ul>\n  <li>a\n{.k\ntail</li>\n</ul>')
    expect(carveToHtml('> q\n> {.k\ntail\n')).toBe('<blockquote><p>q\n{.k\ntail</p></blockquote>')
    expect(carveToHtml('> {.k\ntail\n')).toBe('<blockquote><p>{.k\ntail</p></blockquote>')
    expect(carveToHtml(':: t\n:  d\n   {.k\ntail\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>d\n{.k\ntail</dd>\n</dl>',
    )
  })

  it('a run still open on its SECOND line holds it open too', () => {
    // Three lines, so the run's CONTINUATION is what answers rather than its
    // opener. A two-line document never reaches that branch, which is how a
    // mutant that closed the paragraph on every open continuation survived the
    // rows above.
    expect(carveToHtml('- a\n  {.k\n  .j\ntail\n')).toBe(
      '<ul>\n  <li>a\n{.k\n.j\ntail</li>\n</ul>',
    )
    expect(carveToHtml('> q\n> {.k\n> .j\ntail\n')).toBe(
      '<blockquote><p>q\n{.k\n.j\ntail</p></blockquote>',
    )
  })

  it('an open run does not stop the classifiers reading the lines below it', () => {
    // The run is a SIDE CHANNEL: it only ever overrides, and only when it closes
    // as real attributes. A version that returned early while the run waited
    // stopped reading structure below it, so a quote whose last block is a
    // heading kept the flush-left line, and an item ending in a break or a table
    // absorbed it. carve-rs `b6ff319c` produces all three.
    expect(carveToHtml('> q\n> {.k\n> # H\ntail\n')).toBe(
      '<blockquote>\n  <p>q\n{.k</p>\n  <h1 id="H">H</h1>\n</blockquote>\n<p>tail</p>',
    )
    expect(carveToHtml('- a\n  {.k\n  ---\ntail\n')).toBe(
      '<ul>\n  <li>a\n{.k\n    <hr>\n  </li>\n</ul>\n<p>tail</p>',
    )
    expect(carveToHtml('- a\n  {.k\n  |x|\ntail\n')).toBe(
      '<ul>\n  <li>a\n{.k\n    <table>\n      <tbody>\n        <tr><td>x</td></tr>\n      </tbody>\n    </table>\n  </li>\n</ul>\n<p>tail</p>',
    )
  })

  it('a blank line refuses an open run, as the collector does', () => {
    // `tryCollectBlockAttributes` stops at a blank inside an open brace, so the
    // lines are prose and the blank is an ordinary separator.
    expect(carveToHtml('- a\n  {.k\n\n  #x}\ntail\n')).toBe(
      '<ul>\n  <li><p>a\n{.k</p>\n    <p><span class="tag"><strong>#x</strong></span>}\ntail</p>\n  </li>\n</ul>',
    )
  })

  it('a run that does not PARSE is prose, and its last line is classified', () => {
    // `{1a}` is a digit-first identifier: §15 A6 leaves the block literal, and
    // the wrapped spelling has to reach the same answer rather than being
    // swallowed by the run. Asserted in FULL: a `toContain` on the braces passes
    // for a reader that closes the container too, since the text is published
    // either way and only its place differs.
    expect(carveToHtml('- a\n  {1a\n  b}\ntail\n')).toBe(
      '<ul>\n  <li>a\n{1a\nb}\ntail</li>\n</ul>',
    )
    expect(carveToHtml('- a\n  {1a}\ntail\n')).toBe('<ul>\n  <li>a\n{1a}\ntail</li>\n</ul>')
  })

  // The controls that keep "scoped" from reading as "dropped".
  it('inside its own container the attribute still attaches', () => {
    expect(carveToHtml('> {.k}\n>\n> tail\n')).toBe(
      '<blockquote><p class="k">tail</p></blockquote>',
    )
    expect(carveToHtml('- a\n  {.k}\n  # H\n')).toBe(
      '<ul>\n  <li>a\n    <h1 class="k" id="H">H</h1>\n  </li>\n</ul>',
    )
    expect(carveToHtml(':: t\n:  d\n   {.k}\n   # H\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>d</p>\n    <h1 class="k" id="H">H</h1>\n  </dd>\n</dl>',
    )
  })

  it('a document-level attribute still floats across a blank line', () => {
    expect(carveToHtml('{.k}\n\ntail\n')).toBe('<p class="k">tail</p>')
  })
})
