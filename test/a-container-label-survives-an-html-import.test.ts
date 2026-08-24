import { describe, expect, it } from 'vitest'
import { carveToHtml, htmlToCarve } from '../src/index.js'

const importSource = (html: string) => htmlToCarve(html, { mode: 'roundtrip' })
const roundTrip = (src: string) => importSource(carveToHtml(src)).value

/**
 * A GROUPING LABEL IS SOMETHING ONLY A CONTAINER CAN HOLD
 * (`markup-carve/carve-js#1413`, ruled on `markup-carve/carve-rs#1315`, spec
 * clause `markup-carve/carve#1650`).
 *
 * PART 9 §10's `[label]` has no spelling anywhere but on a container's OPENER.
 * The HTML renderer degrades it to a `<p class="div-label">` inside the
 * container, so an import that leaves that paragraph in the body writes it back
 * as ordinary content carrying the renderer's own class.
 *
 * TWO SEPARATE DEFECTS, and they only produce `::: [g]` together.
 *
 *   THE BOUNDARY. `markup-carve/carve#1578` unwraps a div that carries nothing
 *   only a container can hold, and wrote that test as `attrs`. Its own rationale
 *   said why - "the moment a div carries any attribute the language can hold,
 *   the fence comes back, because then there IS something only the container can
 *   hold" - and a label meets that description exactly, so the proxy was
 *   narrower than the principle it stood in for.
 *
 *   THE LIFT. Even a div that SURVIVED did not put its label back on its opener,
 *   because carve-js had no lift on any arm at all.
 *
 * Widening the boundary alone makes it WORSE rather than better: the div then
 * keeps its fence and the label is dropped silently instead of surfacing as a
 * paragraph. That is why both halves are here and why each is reverted on its
 * own in the red proof.
 *
 * WHAT MADE IT NOT DECLARABLE. `::: [g]` came back as a `{.div-label}`
 * paragraph: the container gone and the label now body content. That is not a
 * LOSS an import may declare, it is an ADDITION - the document saying something
 * it never said - and with a raw label holding markup it said something NEW on
 * every pass as the escaping compounded.
 */
describe('a container label survives an html import', () => {
  // THE DISCRIMINATING CASE: a div carrying a label and NOTHING ELSE. This is
  // the only shape that can see the boundary at all - a div with an attribute
  // as well as a label survives on the attribute either way.
  it('brings the fence back for a label with no attribute beside it', () => {
    expect(roundTrip('::: [g]\nBody.\n:::\n')).toBe('::: [g]\nBody.\n:::\n')
  })

  it('puts a surviving plain div’s label back on its opener', () => {
    expect(roundTrip('{#foo}\n::: [g]\nBody.\n:::\n')).toBe('{#foo}\n::: [g]\nBody.\n:::\n')
  })

  it('puts a container-class label back on its opener', () => {
    expect(roundTrip('::: note [g]\nBody.\n:::\n')).toBe('::: note [g]\nBody.\n:::\n')
  })

  it('puts a figure’s label back on its opener', () => {
    expect(roundTrip('::: figure [g]\nBody.\n:::\n')).toBe('::: figure [g]\nBody.\n:::\n')
  })

  // THE RAW-RUN HALF. A label is a raw string and a paragraph escapes what it
  // holds, so this shape said something new on each pass: `[a *b*]` came back
  // as `a \*b*`.
  it('keeps a label that holds a raw markup run', () => {
    expect(roundTrip('{#foo}\n::: [a *b*]\nBody.\n:::\n')).toBe(
      '{#foo}\n::: [a *b*]\nBody.\n:::\n',
    )
  })

  it('keeps a title and a label together, in that order', () => {
    expect(roundTrip('::: note "A" [g]\nBody.\n:::\n')).toBe('::: note "A" [g]\nBody.\n:::\n')
  })

  it('lifts through the indentation the renderer actually writes', () => {
    expect(importSource('<div id="x">\n  <p class="div-label">g</p>\n  <p>Body.</p>\n</div>').value).toBe(
      '{#x}\n::: [g]\nBody.\n:::\n',
    )
  })

  // A label is a bare string with no attribute slot, so what the degraded
  // paragraph carried cannot come with it - stated rather than dropped silently.
  it('reports an attribute riding the degraded paragraph', () => {
    const report = importSource('<div id="x"><p class="div-label keep" data-k="v">g</p></div>').report
    expect(report.diagnostics.map((d) => d.code)).toContain('attribute-dropped')
  })
})

/**
 * THE REFUSALS, which are also the boundary's near-miss controls.
 *
 * A refused lift means the div kept NOTHING, so it must still unwrap exactly as
 * it did before - the boundary reads what the div actually kept, not what its
 * markup looked like. Each of these therefore fails in BOTH directions: it goes
 * red if the lift stops refusing, and red again if the widened boundary starts
 * keeping a fence the lift never earned.
 */
describe('the labels the lift refuses, and the divs that still unwrap', () => {
  const unwrapped = (html: string) => importSource(html).value

  // The field is raw and the writer emits it raw, so lifting a paragraph
  // holding markup would flatten the markup and lose it without a word.
  it('refuses a label paragraph holding markup, and the div unwraps', () => {
    const out = unwrapped('<div><p class="div-label">a <em>b</em></p><p>Body.</p></div>')
    expect(out).not.toContain(':::')
    expect(out).toContain('{.div-label}')
  })

  // `]` closes the label, so it has no spelling on an opener.
  it('refuses a label holding `]`, and the div unwraps', () => {
    const out = unwrapped('<div><p class="div-label">a]b</p><p>Body.</p></div>')
    expect(out).not.toContain(':::')
    expect(out).toContain('{.div-label}')
  })

  it('refuses a label that is not the first element, and the div unwraps', () => {
    const out = unwrapped('<div><p>first</p><p class="div-label">g</p></div>')
    expect(out).not.toContain(':::')
    expect(out).toContain('{.div-label}')
  })

  /*
   * THE OTHER "FURTHER DOWN". The search finds the first ELEMENT, which is not
   * the first thing in the container: bare text ahead of the paragraph is still
   * text the author wrote, and lifting the label onto the opener would MOVE it
   * in front of that text. The renderer never writes bare text before the
   * label, so this is foreign HTML rather than this engine's own output.
   */
  it('refuses a label that follows visible text, and does not reorder it', () => {
    const out = unwrapped('<div><p class="div-label">g</p><p>Body.</p></div>'.replace('<div>', '<div>prefix'))
    expect(out).not.toContain(':::')
    expect(out.indexOf('prefix')).toBeLessThan(out.indexOf('{.div-label}'))
  })

  it('leaves a div with neither attribute nor label unwrapping', () => {
    expect(unwrapped('<div><p>Body.</p></div>')).toBe('Body.\n')
  })
})

/**
 * THE BUDGET, asserted as a RELATIONSHIP rather than a constant.
 *
 * The lift removes the label paragraph before the block walk reaches it, so its
 * text child is a DOM node nothing else will ever charge. Left uncharged, a
 * labelled container costs one node and one level LESS than the same DOM
 * without a label - a way to process more than `maxNodes` allows by ADDING
 * markup rather than removing it.
 *
 * The floor is found by bisection and compared against the floor of the same
 * DOM with the label class taken off, so the assertion survives a different
 * machine, a different allocator and a different default. A named constant here
 * would describe the machine that measured it.
 */
describe('a lifted label costs the budget the paragraph it replaces cost', () => {
  const fits = (html: string, limit: number, key: 'maxNodes' | 'maxDepth' = 'maxNodes'): boolean => {
    try {
      htmlToCarve(html, { mode: 'roundtrip', [key]: limit })
      return true
    } catch {
      return false
    }
  }

  const nodeFloor = (html: string): number => {
    let low = 0
    let high = 4096
    expect(fits(html, high), '4096 nodes was not enough').toBe(true)
    while (low + 1 < high) {
      const mid = Math.floor((low + high) / 2)
      if (fits(html, mid)) high = mid
      else low = mid
    }
    return high
  }

  it('charges a labelled container what the same DOM without a label costs', () => {
    const labelled = '<div id="x"><p class="div-label">g</p><p>Body.</p></div>'
    const plain = '<div id="x"><p class="other">g</p><p>Body.</p></div>'
    expect(nodeFloor(labelled)).toBe(nodeFloor(plain))
  })

  /*
   * THE DEPTH HALF, AND ITS FIXTURE IS A DIFFERENT SHAPE ON PURPOSE.
   *
   * The node fixture above carries a `<p>Body.</p>` beside the label, and that
   * sibling sets the depth floor on its own - so both documents measure 4
   * whether the lift charges the right level or not, and the node assertion
   * could not see the depth defect at all. It was a test narrower than its own
   * stated rationale, which is the same shape as the ticket it belongs to.
   *
   * The discriminating shape is one where the LABEL IS THE DEEPEST CONTENT.
   * Charged a level shallow, `<div id="x"><p class="div-label">g</p></div>`
   * imported at `maxDepth: 3` while its unlabelled twin needed 4 - a labelled
   * document admitted at a depth the same DOM is refused at. Raised by codex
   * review with exactly this measurement.
   */
  const depthFloor = (html: string): number => {
    let low = 0
    let high = 64
    expect(fits(html, high, 'maxDepth'), '64 levels was not enough').toBe(true)
    while (low + 1 < high) {
      const mid = Math.floor((low + high) / 2)
      if (fits(html, mid, 'maxDepth')) high = mid
      else low = mid
    }
    return high
  }

  it('charges a lifted label the DEPTH the block walk would have charged', () => {
    expect(depthFloor('<div id="x"><p class="div-label">g</p></div>')).toBe(
      depthFloor('<div id="x"><p class="other">g</p></div>'),
    )
  })

  /*
   * The admonition TITLE lift had the identical gap, and its node charge was
   * already right - so only a depth fixture can see it at all.
   *
   * TWO FIXTURES, because the lift charges in two places and each has its own
   * discriminating shape. An EMPTY title is charged only by the element charge,
   * so it is the only shape that can see that one (measured 2 against 3 when it
   * is a level shallow). A NON-EMPTY title's inline walk goes deeper than the
   * element ever does, so it sees the inline charge instead and cannot see the
   * element charge at all (measured 3 against 4). One fixture would have left
   * whichever half it does not reach unpinned.
   */
  const titled = (cls: string, body: string) =>
    `<aside class="admonition note"><p class="${cls}">${body}</p></aside>`

  it('charges an EMPTY lifted title the depth the block walk would have charged', () => {
    expect(depthFloor(titled('admonition-title', ''))).toBe(depthFloor(titled('other', '')))
  })

  it('charges a lifted title’s CONTENT the depth the block walk would have charged', () => {
    expect(depthFloor(titled('admonition-title', 'T'))).toBe(depthFloor(titled('other', 'T')))
  })
})
