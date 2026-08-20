import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

/*
 * PART 9 §8 (markup-carve/carve#1443): a hyphen run PRECEDED by whitespace (or
 * the start of the content) and FOLLOWED by a non-whitespace character is a
 * long CLI flag, not a dash, and stays literal.
 *
 * The failure it repairs was silent and output-only: the author saw
 * `git log --oneline` in the source and the reader got a command that does not
 * run. Nothing warned, and nothing in the source looked wrong.
 */
describe('a flag-shaped hyphen run is literal', () => {
  it('leaves a long CLI flag alone', () => {
    expect(h('git log --oneline and --force-with-lease')).toBe(
      '<p>git log --oneline and --force-with-lease</p>',
    )
  })

  it('leaves a flag at the start of the content alone', () => {
    expect(h('--force x')).toBe('<p>--force x</p>')
  })

  it('still converts every other position', () => {
    // The narrowness is the design: each of these is a canonical dash use, and
    // a wider rule (whitespace on both sides, or sides matching in kind) would
    // have taken one of them with it.
    expect(h('pages 1--10')).toBe('<p>pages 1–10</p>')
    expect(h('the Mon--Fri window')).toBe('<p>the Mon–Fri window</p>')
    expect(h('a thought---interrupted---resumes')).toBe(
      '<p>a thought—interrupted—resumes</p>',
    )
    expect(h('a -- b')).toBe('<p>a – b</p>')
    expect(h('text --')).toBe('<p>text –</p>')
    expect(h('a---- b----- c------')).toBe('<p>a–– b—– c——</p>')
  })

  it('does not leave a tail of the run for the arrow token', () => {
    // Declining the run one hyphen at a time left `-->` as a stray `-` plus a
    // live `->`, which rendered `-→`. The whole run is consumed as text.
    expect(h('x -->')).toBe('<p>x --&gt;</p>')
    expect(h('x ---foo')).toBe('<p>x ---foo</p>')
  })

  it('repairs the closing half of an HTML comment, and only that half', () => {
    // A known and stated limit: the opening run is preceded by `!` rather than
    // whitespace, so it still converts.
    expect(h('<!-- c -->')).toBe('<p>&lt;!– c --&gt;</p>')
  })

  it('reads PART 7 spaces, not the host regex class', () => {
    // A VERTICAL TAB and a FORM FEED are CONTENT in Carve, so a run followed by
    // one answers the way a run followed by an ordinary content character
    // answers. `\s` takes both, and spelling the test with it made `---<VT>`
    // convert while `---!` stayed literal (carve#1443 follow-up).
    for (const probe of ['!', '\u000b', '\u000c']) {
      expect(h(`---${probe}`)).toBe(`<p>---${probe}</p>`)
    }

    // A NO-BREAK SPACE is a space to the reader, in both of its spellings.
    expect(h('a\u00a0--foo')).toBe('<p>a&nbsp;--foo</p>')
    expect(h('a\\ --foo')).toBe('<p>a&nbsp;--foo</p>')
  })

  it('writes a literal run back as the hyphens the author wrote', () => {
    const src = 'git log --oneline\n'
    expect(carveToCarve(src)).toBe(src)
    expect(carveToHtml(carveToCarve(src))).toBe(carveToHtml(src))
  })
})
