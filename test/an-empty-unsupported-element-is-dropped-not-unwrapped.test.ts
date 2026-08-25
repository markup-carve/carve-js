/*
 * An unsupported element with nothing to unwrap is DROPPED, not unwrapped
 * (ruling markup-carve/carve#1738).
 *
 * `element-unwrapped` makes a claim about CONTENT: the wrapper went and what it
 * held stayed. An empty `<progress>` held nothing and a void `<input>` can hold
 * nothing, so nothing stayed, and calling either one unwrapped states something
 * about content that did not happen. `element-dropped` says the element and its
 * content both went, which for an empty one is exactly true. The severity
 * follows the code: an unwrap preserves text and is `info`, a drop does not and
 * is `warning`.
 *
 * BOTH HALVES OF THE SAME ELEMENT, deliberately. A test that only pinned the
 * empty case passes an implementation that made every unsupported element
 * `dropped`, which would be a worse report than the one this replaces - so each
 * element below is asserted twice, once holding fallback content and once
 * empty, and the pair has to come out `element-unwrapped` / `info` then
 * `element-dropped` / `warning`.
 *
 * NOT A LIST OF TAG NAMES. The elements the ruling names agree with carve-php
 * whenever they have children and diverge only when they do not, so what
 * decides is content and a name list would be back next sweep
 * (markup-carve/carve#1704). The CONTROL half of that is the unrelated tags at
 * the bottom, which have no place on any list and take the same two answers.
 *
 * ORDER IS ASSERTED WITH THE ROW, because carve-php#1739 pinned the element row
 * ahead of the attribute rows for its element and this change rewrites the row
 * that stands there. Asserting the code alone would pass an implementation that
 * emitted it after the attributes it is supposed to introduce.
 */
import { describe, expect, it } from 'vitest'
import { htmlToCarve } from '../src/index.js'

const rows = (html: string) =>
  htmlToCarve(html).report.diagnostics.map((d) => `${d.code} :: ${d.severity}`)

const elementRows = (html: string) =>
  htmlToCarve(html)
    .report.diagnostics.filter((d) => d.code === 'element-dropped' || d.code === 'element-unwrapped')
    .map((d) => `${d.code} :: ${d.severity}`)

/**
 * The four the ruling measured, plus two the ruling did not, each written twice:
 * holding fallback content, and holding nothing.
 *
 * `input` has only the empty spelling because it is void - it can never carry
 * children, which is exactly why it can never be unwrapped.
 */
const PAIRS: Array<{ tag: string; withContent: string; empty: string }> = [
  { tag: 'progress', withContent: '<progress value="1">FALLBACK</progress>', empty: '<progress value="1"></progress>' },
  { tag: 'meter', withContent: '<meter value="1">FALLBACK</meter>', empty: '<meter value="1"></meter>' },
  { tag: 'audio', withContent: '<audio controls>FALLBACK</audio>', empty: '<audio controls></audio>' },
  { tag: 'video', withContent: '<video controls>FALLBACK</video>', empty: '<video controls></video>' },
  { tag: 'canvas', withContent: '<canvas>FALLBACK</canvas>', empty: '<canvas></canvas>' },
  { tag: 'button', withContent: '<button>FALLBACK</button>', empty: '<button></button>' },
  // The four unmapped BLOCK tags and a sectioning wrapper reach two other call
  // sites, and the same tag reaches a different one of the three in each
  // engine - a `<form>` takes carve-rs's inline arm and this engine's block
  // arm. Applying the rule to one arm would have fixed thirty-two shapes and
  // broken seven, so all three are here.
  { tag: 'form', withContent: '<form>FALLBACK</form>', empty: '<form></form>' },
  { tag: 'fieldset', withContent: '<fieldset>FALLBACK</fieldset>', empty: '<fieldset></fieldset>' },
  { tag: 'address', withContent: '<address>FALLBACK</address>', empty: '<address></address>' },
  { tag: 'hgroup', withContent: '<hgroup>FALLBACK</hgroup>', empty: '<hgroup></hgroup>' },
  { tag: 'section', withContent: '<section>FALLBACK</section>', empty: '<section></section>' },
  { tag: 'article', withContent: '<article>FALLBACK</article>', empty: '<article></article>' },
  { tag: 'dialog', withContent: '<dialog>FALLBACK</dialog>', empty: '<dialog></dialog>' },
]

describe('an unsupported element with nothing to unwrap', () => {
  for (const { tag, withContent, empty } of PAIRS) {
    it(`reports <${tag}> unwrapped when it has content and dropped when it has none`, () => {
      expect(elementRows(withContent)).toEqual(['element-unwrapped :: info'])
      expect(elementRows(empty)).toEqual(['element-dropped :: warning'])
    })
  }

  it('reports a void <input> dropped: it can never have had children to unwrap', () => {
    expect(elementRows('<input type="text" value="v">')).toEqual(['element-dropped :: warning'])
  })

  /*
   * WHITESPACE IS NOT CONTENT. An unwrap that leaves a blank line behind
   * preserved nothing a reader can see, and the emitted source proves it: the
   * document is empty either way.
   */
  it('reports an element holding only whitespace dropped, and writes nothing', () => {
    expect(htmlToCarve('<progress value="1">   </progress>').value.trim()).toBe('')
    expect(elementRows('<progress value="1">   </progress>')).toEqual(['element-dropped :: warning'])
  })

  /*
   * AN ACTIVE CHILD IS NOT CONTENT EITHER. A `<script>` never survives an
   * import, so an element whose only child is one had nothing an unwrap could
   * preserve - and the `<script>` reports its own drop, which is why the parent
   * saying `element-unwrapped` would be the only false row of the two.
   */
  it('reports an element whose only child is active dropped, beside the active drop', () => {
    expect(elementRows('<progress value="1"><script>1</script></progress>')).toEqual([
      'element-dropped :: warning',
      'element-dropped :: warning',
    ])
  })

  /*
   * A NON-ACTIVE CHILD ELEMENT IS CONTENT, whatever it writes. The question is
   * asked of the INPUT (markup-carve/carve#1723's framing), and reading it off
   * the emitted source instead would call this `<audio>` dropped for a loss
   * that belongs to the `<span>` inside it - which reports its own row.
   */
  it('reports an element holding an empty child element unwrapped, and the child dropped', () => {
    expect(elementRows('<audio controls><span></span></audio>')).toEqual([
      'element-unwrapped :: info',
      'element-dropped :: warning',
    ])
  })

  /*
   * THE ELEMENT ROW STANDS AHEAD OF THE ATTRIBUTE ROWS IT INTRODUCES
   * (carve-php#1739), in both outcomes. A consumer reads the rows in order, and
   * in the other order it is told what happened to a `<progress>`'s `value`
   * before it is told the `<progress>` is gone.
   */
  it('keeps the element row ahead of its attribute rows in both outcomes', () => {
    expect(rows('<progress value="1">FALLBACK</progress>')).toEqual([
      'element-unwrapped :: info',
      'attribute-dropped :: info',
    ])
    expect(rows('<progress value="1"></progress>')).toEqual([
      'element-dropped :: warning',
      'attribute-dropped :: info',
    ])
  })
})

/*
 * THE CONTROLS. Every row below reported exactly this before the ruling and has
 * to report exactly this after it: the change is the code and the severity on
 * the empty arm, and nothing about WHICH elements report at all.
 */
describe('the rows the ruling does not move', () => {
  it('keeps a <div> earning no element row at all, empty or not', () => {
    for (const html of ['<div></div>', '<div>TEXT</div>']) {
      expect(elementRows(html)).toEqual([])
    }
  })

  it('keeps a renderer-derived <section role="doc-endnotes"> silent', () => {
    expect(elementRows('<section role="doc-endnotes"><ol><li>n</li></ol></section>')).toEqual([])
  })

  it('keeps an active element dropped, with the wording its own arm gives it', () => {
    const diagnostics = htmlToCarve('<script>1</script>').report.diagnostics
    expect(diagnostics.map((d) => `${d.code} :: ${d.severity} :: ${d.message}`)).toEqual([
      'element-dropped :: warning :: Dropped active <script> element',
    ])
  })

  it('keeps a mapped element silent whether it is empty or not', () => {
    for (const html of ['<p></p>', '<p>TEXT</p>', '<em></em>', '<em>TEXT</em>', '<hr>', '<br>']) {
      expect(elementRows(html)).toEqual([])
    }
  })

  it('keeps roundtrip preserving instead of reporting either outcome', () => {
    const preserved = htmlToCarve('<progress value="1"></progress>', { mode: 'roundtrip' }).report.diagnostics
    expect(preserved.map((d) => d.code)).toEqual(['raw-preserved'])
  })
})
