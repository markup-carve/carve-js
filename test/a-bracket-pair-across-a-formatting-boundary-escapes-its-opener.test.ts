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
 */
import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToCarve } from '../src/index.js'

describe('a bracket pair across a formatting boundary escapes its opener', () => {
  it.each([
    ['[<em>a](b)</em>', '\\[/a](b)/'],
    ['[<strong>a](b)</strong>', '\\[*a](b)*'],
    ['<em>[a</em>](b)', '/\\[a/](b)'],
    // One shape pays a second backslash: a crossing pair nested inside a literal
    // pair, where the inner closer then answers the outer opener. `[[/a\]/]` also
    // holds; carve-php and carve-rs write these bytes, so the fleet decides any
    // trimming rather than this engine.
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
   * A BRACED delimiter is NOT a boundary this rule reaches, and the escape there
   * is not merely idle - it cost idempotence, which is why these are a gate.
   *
   * Only a bare delimiter run can be isolated. A brace pair survives a bracket
   * run, so `[{^a]^}` re-reads as itself with no backslash anywhere. Escaping the
   * opener anyway wrote `[\[{^a]^}]` for the nested shape, and re-formatting that
   * added a second backslash.
   *
   * WHICH SPELLING A SPAN GETS IS THE WRITER'S CALL, not the node type's: sup,
   * sub, insert and delete are always braced, and an emphasis or strong is braced
   * too whenever its neighbors leave it no bare form. So this asks `writtenBraced`
   * rather than re-deriving the condition.
   */
  it.each([
    ['<p>[<sup>a]</sup></p>', '[{^a]^}'],
    ['<p>[[<sup>a]</sup>]</p>', '[[{^a]^}]'],
    ['<p>[<sub>a]</sub></p>', '[{,a],}'],
    ['<p>[<ins>a]</ins></p>', '[{+a]+}'],
    ['<p>[<del>a]</del></p>', '[{-a]-}'],
    ['<p>[<sup>a](b)</sup></p>', '[{^a]\\(b)^}'],
    // An alphanumeric neighbor leaves the emphasis no bare spelling either.
    ['<p>a[<em>b]</em>c</p>', 'a[{/b]/}c'],
    ['<p>[[<em>a]</em>x</p>', '[[{/a]/}x'],
    ['<p>[[<strong>a]</strong>x</p>', '[[{*a]*}x'],
    ['<p>[[<em>](b)</em>x</p>', '[[{/]\\(b)/}x'],
    // And from the other side: the OPENER under the braced span, the closer above it.
    ['<p>x<em>[a</em>]</p>', 'x{/[a/}]'],
    ['<p><em>[a</em>x]</p>', '{/[a/}x]'],
    ['<p>x<sup>[a</sup>]</p>', 'x{^[a^}]'],
  ])('writes no escape across a braced delimiter: %s', (html, expected) => {
    const out = htmlToCarve(html).value
    expect(out).toBe(`${expected}\n`)
    expect(carveToCarve(out)).toBe(out)
    expect(carveToHtml(out)).toBe(html)
  })

  /*
   * A braced span re-pairs everything under it, so only the OUTERMOST span the
   * pair crosses has a say. A bare span nested inside a braced one is safe, and a
   * span holding BOTH brackets is crossed by nothing at all.
   */
  it.each([
    ['<p>[[<sup><em>a]</em></sup>]</p>', '[[{^/a]/^}]'],
    ['<p><em>[[<strong>a]</strong>x</em></p>', '/[[{*a]*}x/'],
    ['<p><em>[a<strong>b]</strong></em></p>', '/[a{*b]*}/'],
  ])('leaves a pair a braced span already protects: %s', (html, expected) => {
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
    // A braced span on the far side declines the rule, so section 4's own check
    // settles this one and the closer keeps the escape it always had.
    ['<p><em>[a</em><em>b]</em></p>', '/[a/{/b\\]/}'],
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
   * This is the gate the spelling cases above cannot be. Each of them pins bytes,
   * and an escape that is merely idle keeps every byte assertion passing - it shows
   * up as a second backslash on the NEXT format, which is what the sweep sees.
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
