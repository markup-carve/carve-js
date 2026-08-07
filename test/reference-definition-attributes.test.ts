import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * PART 9R R1 + §16: a TRAILING attribute block on a link reference definition
 * attaches to the DEFINITION and transfers to every link that resolves the
 * label, with the link's own attributes overriding per key (carve#604).
 *
 * PART 9R already carried the semantics - its symbol table is
 * `linkDefs : label -> (url, title?, attrs?)` and R1 already said definition
 * attributes transfer. What was missing was the PRODUCTION: there was no way to
 * write the `attrs` the rule consumes, so the feature was unreachable rather
 * than undecided.
 */
describe('trailing attributes on a link reference definition', () => {
  it('transfers the definition attributes to the link', () => {
    expect(carveToHtml('[Example][ex]\n\n[ex]: https://example.com {.external}\n')).toBe(
      '<p><a href="https://example.com" class="external">Example</a></p>',
    )
  })

  it('transfers to EVERY link resolving the label, which is the point', () => {
    expect(carveToHtml('[A][ex] [B][ex]\n\n[ex]: /u {.e}\n')).toBe(
      '<p><a href="/u" class="e">A</a> <a href="/u" class="e">B</a></p>',
    )
  })

  // "Override per key" is §15 A3's merge, the one stacked attribute lists
  // already use: a repeated id or key takes the LAST value (the link's) and
  // classes ACCUMULATE across the two lists. A rule where the link's class
  // REPLACED the definition's would make this the only place in Carve where
  // stacking classes drops one.
  it('merges per §15 A3: link wins the key, classes accumulate', () => {
    expect(carveToHtml('[Example][ex]{.internal #b}\n\n[ex]: /u {.external #a}\n')).toBe(
      '<p><a href="/u" class="external internal" id="b">Example</a></p>',
    )
  })

  it('keeps deduplicating a repeated class WITHIN one block', () => {
    // A3 accumulates across lists; inside one attribute block a repeated class
    // still collapses, exactly as it does on an inline link.
    expect(carveToHtml('[x][r]{.a .a}\n\n[r]: /u\n')).toBe('<p><a href="/u" class="a">x</a></p>')
  })

  it('coexists with a title', () => {
    expect(carveToHtml('[E][ex]\n\n[ex]: /u "T" {.x}\n')).toBe(
      '<p><a href="/u" title="T" class="x">E</a></p>',
    )
  })

  // A floating attribute line ABOVE a definition floats PAST it to the next
  // visible block (§15 A2a). The two are different constructs and both are
  // well-defined; this is the case that shows they do not compete.
  it('does not disturb an attribute line above the definition', () => {
    expect(carveToHtml('{.a}\n[ex]: /u {.b}\n\n[E][ex] and text\n')).toBe(
      '<p class="a"><a href="/u" class="b">E</a> and text</p>',
    )
  })

  it('needs a space, so a brace run touching the destination stays in it', () => {
    expect(carveToHtml('[x][r]\n\n[r]: /u{.x}\n')).toBe('<p><a href="/u{.x}">x</a></p>')
  })

  it('does not change what counts as a definition', () => {
    // Written when `[r]: /u junk here` was a definition with its trailing junk
    // ignored; carve#911 anchored the production at end of line, so it is a
    // paragraph now. The property this assertion exists for is unchanged and is
    // what it still tests: reading a trailing ATTRIBUTE block must not move the
    // line's classification either way.
    expect(carveToHtml('[x][r]\n\n[r]: /u junk here\n')).toBe(
      '<p>[x][r]</p>\n<p>[r]: /u junk here</p>',
    )
    expect(carveToHtml('[x][r]\n\n[r]: /u\n')).toBe('<p><a href="/u">x</a></p>')
  })

  // The block is SCANNED rather than regex-matched: a value may hold a `}`
  // inside quotes, and a `\{[^}]*\}` pattern stops at that brace, fails to
  // parse, and drops every attribute on the line silently.
  it('survives a closing brace inside a quoted value', () => {
    expect(carveToHtml('[x][r]\n\n[r]: /u {data-x="}" .a}\n')).toBe(
      '<p><a href="/u" data-x="}" class="a">x</a></p>',
    )
  })

  it('an INVALID attribute block makes the line prose, not a definition', () => {
    // AN INVALID BLOCK IS NOT `attributes`, SO THE LINE IS NOT A DEFINITION
    // (markup-carve/carve#933). This row used to expect the definition to
    // survive with the braces silently dropped from the page. `[space,
    // attributes]` names the `attributes` production, and a balanced `{...}`
    // that production does not accept is not an instance of it; it is leftover
    // content, and the end-of-line anchor disposes of it like any other
    // leftover.
    expect(carveToHtml('[x][r]\n\n[r]: /u {!!!}\n')).toBe(
      '<p>[x][r]</p>\n<p>[r]: /u {!!!}</p>',
    )
  })
})
