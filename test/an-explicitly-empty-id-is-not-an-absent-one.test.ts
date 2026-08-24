import { describe, expect, it } from 'vitest'
import { carveToHtml, htmlToCarve } from '../src/index.js'

/**
 * An explicit empty id is not an absent one. `resolveHeadingIds` states it in
 * its own words - "An explicit id wins verbatim, INCLUDING an explicit empty
 * `id=""` ... it suppresses the auto slug rather than being treated as absent" -
 * so an import that drops one turns a heading the author kept out of every
 * anchor into a heading that has one (markup-carve/carve-js#1463).
 *
 * `attrs()` ended on a TRUTHINESS test, `attrs.id || attrs.classes ||
 * attrs.keyValues`, and `''` is falsy: with nothing else kept beside it the
 * whole `Attrs` was discarded, silently and with no diagnostic. `classes` and
 * `keyValues` are only ever assigned when non-empty, so `id` is the only field
 * that test could be wrong about - which is why the same empty id SURVIVED one
 * attribute later, the disagreement that showed this was not a policy.
 *
 * carve-rs keeps it in every mode and in both shapes; this is the port.
 */
describe('an explicitly empty id is not an absent one', () => {
  it('keeps an empty id that is the only attribute', () => {
    expect(htmlToCarve('<ul><li>a<h1 id="">H</h1></li></ul>').value).toBe('- a\n  {id=""}\n  # H\n')
  })

  it('re-renders it to the HTML it came from, rather than to the slug', () => {
    // THE LOSS, stated as what a reader sees: before this, the source above was
    // `- a\n  # H\n` and rendering it back produced `id="H"` - an anchor the
    // input explicitly suppressed.
    const html = '<ul>\n  <li>a\n    <h1 id="">H</h1>\n  </li>\n</ul>'
    expect(carveToHtml(htmlToCarve(html).value)).toBe(html)
  })

  it('still keeps it beside another attribute, which always worked', () => {
    // THE CONTROL, and the shape that proved the drop was accidental: one
    // attribute more and the empty id came through.
    expect(htmlToCarve('<ul><li>a<h1 id="" class="k">H</h1></li></ul>').value).toBe(
      '- a\n  {id="" .k}\n  # H\n',
    )
  })

  it('is not heading-specific, because `attrs` serves every element', () => {
    expect(htmlToCarve('<p id="">x</p>').value).toBe('{id=""}\nx\n')
  })

  it('leaves an element with no attributes at all alone', () => {
    // THE OTHER CONTROL. Widening the test from truthiness to "is it present"
    // must not start emitting an attribute block for an element that carried
    // nothing.
    expect(htmlToCarve('<ul><li>a<h1>H</h1></li></ul>').value).toBe('- a\n  # H\n')
    expect(htmlToCarve('<p>x</p>').value).toBe('x\n')
  })

  it('keeps it in every mode', () => {
    for (const mode of ['safe', 'semantic', 'roundtrip'] as const) {
      // Even in `roundtrip`: an empty id is not the default slug of anything,
      // so the generated-id carve-out (markup-carve/carve-js#1459) does not
      // reach it.
      expect(htmlToCarve('<ul><li>a<h1 id="">H</h1></li></ul>', { mode }).value).toBe(
        '- a\n  {id=""}\n  # H\n',
      )
    }
  })
})
