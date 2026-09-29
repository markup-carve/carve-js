/*
 * PART 8 resolves a bracket run before the emphasis delimiters, so a run
 * reaching across a formatting boundary isolates the delimiters inside it. The
 * escape therefore falls on the OPENING bracket, and the closer then closes no
 * run, which leaves the `(` behind it bare.
 *
 * BOTH one-escape spellings conform. `\[/a](b)/` and `[/a\](b)/` spend one
 * backslash each, re-parse to the same tree and render the same HTML, so PART 11
 * CARVE-P11-006 does not choose between them - it only rules out the two-escape
 * `[/a\]\(b)/` this engine used to write. What chooses is the shared fixture
 * `tests/html-import/paren-after-a-closed-bracket`, the cross-engine contract for
 * importer output; carve-php took it in markup-carve/carve-php#2756 and carve-rs
 * in markup-carve/carve-rs#2206.
 *
 * THE CROSSED SPAN'S OWN SPELLING DOES NOT ENTER IT. This rule shipped with a
 * clause that declined wherever the writer had braced a crossed span, on the
 * reading that a braced pair survives a bracket run. It does not: the spec's own
 * reader, carve-rs and carve-php all read `[{^a]^}` as literal text, so declining
 * dropped the span for every reader but this one. The bytes below were measured
 * against all three (markup-carve/carve-js#2399).
 */
import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToCarve } from '../src/index.js'

describe('a bracket pair across a formatting boundary escapes its opener', () => {
  it.each([
    ['[<em>a](b)</em>', '\\[/a](b)/'],
    ['[<strong>a](b)</strong>', '\\[*a](b)*'],
    ['<em>[a</em>](b)', '/\\[a/](b)'],
    // One shape pays a second backslash: a crossing pair nested inside a literal
    // pair, where the inner closer then answers the outer opener. carve-php and
    // carve-rs write these bytes, so the fleet decides any trimming rather than
    // this engine.
    ['[[<em>a]</em>]', '[\\[/a\\]/]'],
  ])('%s imports as %s', (body, expected) => {
    const out = htmlToCarve(`<p>${body}</p>`).value
    expect(out).toBe(`${expected}\n`)
    expect(carveToCarve(out)).toBe(out)
    expect(carveToHtml(out)).toBe(`<p>${body}</p>`)
  })

  it('leaves a pair inside one host alone', () => {
    // The paren escape is what the closer of a same-host pair still needs.
    expect(htmlToCarve('<p>[a](b)</p>').value).toBe('[a]\\(b)\n')
    expect(htmlToCarve('<p><em>[a](b</em>)</p>').value).toBe('/[a]\\(b/)\n')
    expect(htmlToCarve('<p>[<em>a</em>](b)</p>').value).toBe('[/a/]\\(b)\n')
    expect(htmlToCarve('<p>[a<em>x</em>b](c)</p>').value).toBe('[a{/x/}b]\\(c)\n')
  })

  /*
   * A BRACED delimiter is crossed like any other. Superscript, subscript, insert
   * and delete are always braced and an emphasis is braced whenever its neighbors
   * leave it no bare form, so this family was the whole of what the old clause
   * declined - which is to say it was where the span went missing.
   *
   * Each spelling was read back by the spec's own reader
   * (`scripts/spec/layout.mjs` plus `scripts/spec/html.mjs` at carve `aa3678a2`,
   * the pinned spec) and comes out as the HTML that wrote it. Unescaped, the same
   * reader returns the source as literal text.
   */
  it.each([
    ['<p>[<sup>a]</sup></p>', '\\[{^a]^}'],
    ['<p>[[<sup>a]</sup>]</p>', '[\\[{^a\\]^}]'],
    ['<p>[<sub>a]</sub></p>', '\\[{,a],}'],
    ['<p>[[<sub>a]</sub>]</p>', '[\\[{,a\\],}]'],
    ['<p>[<ins>a]</ins></p>', '\\[{+a]+}'],
    ['<p>[<del>a]</del></p>', '\\[{-a]-}'],
    ['<p>[<sup>a](b)</sup></p>', '\\[{^a](b)^}'],
    // An alphanumeric neighbor leaves the emphasis no bare spelling either.
    ['<p>a[<em>b]</em>c</p>', 'a\\[{/b]/}c'],
    ['<p>[[<em>a]</em>x</p>', '[\\[{/a\\]/}x'],
    ['<p>[[<strong>a]</strong>x</p>', '[\\[{*a\\]*}x'],
    ['<p>[[<em>](b)</em>x</p>', '[\\[{/\\](b)/}x'],
    // And from the other side: the OPENER under the braced span, the closer above it.
    ['<p>x<em>[a</em>]</p>', 'x{/\\[a/}]'],
    ['<p><em>[a</em>x]</p>', '{/\\[a/}x]'],
    ['<p>x<sup>[a</sup>]</p>', 'x{^\\[a^}]'],
  ])('escapes across a braced delimiter too: %s', (html, expected) => {
    const out = htmlToCarve(html).value
    expect(out).toBe(`${expected}\n`)
    expect(carveToCarve(out)).toBe(out)
    expect(carveToHtml(out)).toBe(html)
  })

  /*
   * Only the OUTERMOST span a pair crosses decides, and a span holding BOTH
   * brackets is crossed by nothing at all.
   */
  it.each([
    ['<p>[[<sup><em>a]</em></sup>]</p>', '[\\[{^/a\\]/^}]'],
    ['<p><em>[[<strong>a]</strong>x</em></p>', '/[\\[{*a\\]*}x/'],
    ['<p><em>[a<strong>b]</strong></em></p>', '/\\[a{*b]*}/'],
  ])('reads the crossing from the outermost span: %s', (html, expected) => {
    const out = htmlToCarve(html).value
    expect(out).toBe(`${expected}\n`)
    expect(carveToCarve(out)).toBe(out)
    expect(carveToHtml(out)).toBe(html)
  })

  /*
   * A pair crossing in the OTHER direction - opener under the span, closer above
   * it - takes the same escape, because the run would split that span's closing
   * delimiter instead of its opener.
   */
  it.each([
    ['<p><em>[a</em>]</p>', '/\\[a/]'],
    ['<p><em>[a</em>](b)</p>', '/\\[a/](b)'],
    ['<p><em>[a</em><em>b]</em></p>', '/\\[a/{/b]/}'],
  ])('escapes the opener when the pair crosses upward: %s', (html, expected) => {
    const out = htmlToCarve(html).value
    expect(out).toBe(`${expected}\n`)
    expect(carveToCarve(out)).toBe(out)
    expect(carveToHtml(out)).toBe(html)
  })

  /*
   * The rule reaches every placement of a bracket around a formatting span, so the
   * INVARIANTS are swept rather than sampled: each import re-formats to itself and
   * comes back as the HTML that wrote it.
   *
   * IT CANNOT SEE THE DEFECT ABOVE, and that is worth stating where the sweep
   * lives. `carveToHtml` is this engine's reader, which is more permissive here
   * than the spec's: all 993 shapes the old clause declined on passed both
   * assertions while reading as literal text everywhere else. Only running the
   * imported source through a foreign reader separated them, which is why the
   * families above pin bytes measured against one.
   */
  it('holds the writer invariants across every placement', () => {
    const tags = ['em', 'strong', 'u', 's', 'mark', 'sup', 'sub', 'ins', 'del']
    const before = ['', '[', '[[', 'x[', '[x', 'x']
    const inside = ['a]', ']', 'a', '[a', 'a](b)', '](b)', '[a]', 'a]b']
    const after = ['', ']', 'x', '](b)', ']]', '[', 'x]']
    const broken: string[] = []
    let seen = 0
    for (const tag of tags) {
      for (const a of before) {
        for (const b of inside) {
          for (const c of after) {
            const html = `<p>${a}<${tag}>${b}</${tag}>${c}</p>`
            const out = htmlToCarve(html).value
            seen++
            if (carveToCarve(out) !== out) broken.push(`${html} -> ${out} re-formats to ${carveToCarve(out)}`)
            else if (carveToHtml(out) !== html) broken.push(`${html} -> ${out} reads back as ${carveToHtml(out)}`)
          }
        }
      }
    }
    expect(broken).toEqual([])
    expect(seen).toBe(tags.length * before.length * inside.length * after.length)
  })

  it('writes one escape where the engine used to write two', () => {
    // The minimality half of CARVE-P11-006: dropping the paren escape leaves the
    // re-parse untouched, so the old spelling carried an idle one.
    const out = htmlToCarve('<p>[<em>a](b)</em></p>').value
    expect(out.split('\\').length - 1).toBe(1)
    expect(carveToHtml('[/a\\]\\(b)/\n')).toBe(carveToHtml(out))
  })
})
