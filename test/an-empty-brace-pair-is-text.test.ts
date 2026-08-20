import { describe, it, expect } from 'vitest'
import { carveToAstJson, carveToCarve, carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

/*
 * markup-carve/carve#1447, two rules that arrived together.
 *
 * AN EMPTY BRACE PAIR IS NOT A CONSTRUCT. Every content slot involved is a
 * one-or-more repetition - `forced_content` and `inline_content` both - so an
 * opener that meets its own closer opened nothing and its characters are text.
 * This engine already read the forced spans that way; the editorial family is
 * what moves.
 *
 * A BRACED HYPHEN PAIR IS AN EN DASH. The bare run carries a flanking guard
 * (carve#1443), so `x --verbose y` stays literal and an author who meant a dash
 * in that position had no way to say so. `{--}` is that way, and it cost
 * nothing: the string it took was an empty `<del>`.
 */
describe('an empty brace pair is text', () => {
  it('leaves every empty forced span literal', () => {
    for (const pair of ['{//}', '{**}', '{__}', '{~~}', '{^^}', '{,,}', '{==}']) {
      expect(h(pair)).toBe(`<p>${pair}</p>`)
    }
  })

  it('leaves the empty addition and the empty comment literal', () => {
    expect(h('{++}')).toBe('<p>{++}</p>')
    expect(h('{##}')).toBe('<p>{##}</p>')
  })

  it('does not swallow the next construct of the same kind', () => {
    // The empty pair being text has to mean it STOPS there. The forced-span
    // pattern's lazy run grew past its own closer instead, so `{//} x {/y/}`
    // came back as one `<em>` holding `/} x {/y` - the empty pair eating the
    // construct after it, which is worse than the empty element it replaced.
    expect(h('{//} x {/y/}')).toBe('<p>{//} x <em>y</em></p>')
    expect(h('{**} x {*b*}')).toBe('<p>{**} x <strong>b</strong></p>')
    expect(h('{~~} x {~s~}')).toBe('<p>{~~} x <s>s</s></p>')
    expect(h('{==} x {=h=}')).toBe('<p>{==} x <mark>h</mark></p>')
    expect(h('{++} x {+y+}')).toBe('<p>{++} x <ins>y</ins></p>')
    expect(h('{--} x {-y-}')).toBe('<p>– x <del>y</del></p>')
  })

  it('still reads a pair that holds something', () => {
    expect(h('{/i/}')).toBe('<p><em>i</em></p>')
    expect(h('{*b*}')).toBe('<p><strong>b</strong></p>')
    expect(h('{~s~}')).toBe('<p><s>s</s></p>')
    expect(h('{+ins+}')).toBe('<p><ins>ins</ins></p>')
    expect(h('{-del-}')).toBe('<p><del>del</del></p>')
    expect(h('{# c #}')).toBe('<p><span class="critic-comment"> c </span></p>')
  })

  it('leaves a fully empty substitution alone', () => {
    // Its halves are independent, and a half-empty substitution is an ordinary
    // edit - a deletion with no replacement, an insertion replacing nothing -
    // so requiring content per half would refuse real documents.
    expect(h('{~a~>~}')).toBe('<p><del>a</del><ins></ins></p>')
    expect(h('{~~>b~}')).toBe('<p><del></del><ins>b</ins></p>')
    expect(h('{~~>~}')).toBe('<p><del></del><ins></ins></p>')
  })

  it('deletes a hyphen where three are written', () => {
    // The one string that moved is the EMPTY deletion. A deletion holding a
    // hyphen is a thing an author writes and is untouched, which is also why
    // there is no braced em dash.
    expect(h('{---}')).toBe('<p><del>-</del></p>')
    expect(h('{-x-}')).toBe('<p><del>x</del></p>')
  })
})

describe('a braced hyphen pair is an en dash', () => {
  it('converts where the bare run is refused', () => {
    expect(h('a ---(p) b')).toBe('<p>a ---(p) b</p>')
    expect(h('a {--}(p) b')).toBe('<p>a –(p) b</p>')
    expect(h('x {--}verbose y')).toBe('<p>x –verbose y</p>')
  })

  it('converts wherever it stands, and consumes its braces', () => {
    expect(h('x{--}y')).toBe('<p>x–y</p>')
    expect(h('{--}start')).toBe('<p>–start</p>')
    expect(h('{--}{--}')).toBe('<p>––</p>')
  })

  it('is inline content, so a span holds it', () => {
    expect(h('*a {--} b*')).toBe('<p><strong>a – b</strong></p>')
    expect(h('[a {--} b](u)')).toBe('<p><a href="u">a – b</a></p>')
  })

  it('is not read inside a code span', () => {
    expect(h('`{--}`')).toBe('<p><code>{--}</code></p>')
  })

  it('is the same node the bare run produces, so the writer keeps it', () => {
    // Not a glyph in a text run: `fmt` preserves `--` and `...` because they
    // are `smart_punctuation` carrying the authored spelling, and the braced
    // form is a second spelling of the same kind rather than a second
    // construct. Written as text it formatted to a literal en dash and the
    // author's `{--}` was gone.
    const inlines = (carveToAstJson('a {--} b\n') as any).children[0].children
    expect(inlines[1].type).toBe('smart_punctuation')
    expect(inlines[1].kind).toBe('en_dash')
    expect(inlines[1].value).toBe('{--}')
    expect(inlines[1].pos.startOffset).toBe(2)
    expect(inlines[1].pos.endOffset).toBe(6)

    expect(carveToCarve('a {--} b\n')).toBe('a {--} b\n')
    for (const src of ['a {--} b\n', '{--}start\n', '{---} and {-x-}\n']) {
      expect(carveToHtml(carveToCarve(src))).toBe(carveToHtml(src))
    }
  })
})
