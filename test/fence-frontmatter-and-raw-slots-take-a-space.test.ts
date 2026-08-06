import { describe, expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

// PART 7, MARKER SEPARATORS AND PADDING SLOTS, is normative and decides the
// terminal by POSITION rather than by role: "A tab is syntax ONLY in a line's
// LEADING INDENTATION RUN. From the first non-whitespace character of the line
// onward a tab is not relevant to syntax at all: it satisfies no slot in any
// production, and no construct is recognized by it."
//
// Three openers in this engine spelled a slot wider than that. Every slot they
// carry sits after the fence run or after the `---` pair, so every one of them
// is spelled `space` in the grammar:
//
//   fenced_code_block = code_fence_open, [space], [code_fence_info], newline, ...
//   code_fence_info   = ( language_info, [space+, quoted_title], [space+, label] )
//                     | ( quoted_title, [space+, label] )
//                     | label ;
//   frontmatter_open  = "---", [space], [frontmatter_format], newline ;
//   raw_block         = code_fence_open, [space], "=", format_name, newline, ...
//
// The roles differ - the code fence's slots are PADDING (the fence run has
// already decided the block), the raw block's is a MARKER SEPARATOR (the `=`
// after it selects a raw block over a code block) - but the role decides what a
// FAILED match means, not the terminal. Both land on prose here.
//
// Two things these fixtures are deliberately careful about:
//
//   1. A RUN, not a first character. A rule about a whitespace RUN implemented
//      as a check on the run's first character passes `<TAB>` and `<SP><TAB>`
//      differently for no stateable reason, so both mixed orders are asserted
//      per slot.
//   2. `\s` is not `[ \t]`. JavaScript's `\s` is Unicode White_Space plus
//      U+FEFF minus U+0085, so a form feed, a vertical tab and U+2000 reached
//      these slots too. Those are a wider divergence than the tab and get their
//      own rows rather than riding on the tab's.

const TAB = '\t'
const FF = '\f'
const VT = '\v'
const NQSP = ' ' // EN QUAD - White_Space, and not a `space`
const F = '```'

/** The four characters `\s` admitted here that the grammar never names. */
const WIDE: ReadonlyArray<readonly [string, string]> = [
  ['a tab', TAB],
  ['a form feed', FF],
  ['a vertical tab', VT],
  ['U+2000', NQSP],
]

/** Both orders of a mixed run - the shape a first-character check gets wrong. */
const MIXED: ReadonlyArray<readonly [string, string]> = [
  ['a space then a tab', ' ' + TAB],
  ['a tab then a space', TAB + ' '],
]

describe("the code fence's slot before the info string takes a space", () => {
  it('opens a code block on a space, and on no space at all', () => {
    expect(carveToHtml(`${F} js\nx\n${F}\n`)).toContain('class="language-js"')
    expect(carveToHtml(`${F}js\nx\n${F}\n`)).toContain('class="language-js"')
  })

  for (const [name, ws] of WIDE) {
    it(`does not open a code block on ${name}`, () => {
      const html = carveToHtml(`${F}${ws}js\nx\n${F}\n`)
      expect(html).not.toContain('class="language-js"')
      expect(html).not.toContain('<pre>')
    })
  }

  for (const [name, ws] of MIXED) {
    it(`does not open a code block on ${name}`, () => {
      const html = carveToHtml(`${F}${ws}js\nx\n${F}\n`)
      expect(html).not.toContain('class="language-js"')
      expect(html).not.toContain('<pre>')
    })
  }

  it('still opens on a run of two spaces (cardinality is a separate question)', () => {
    expect(carveToHtml(`${F}  js\nx\n${F}\n`)).toContain('class="language-js"')
  })
})

describe("the code fence's header slot takes a space", () => {
  it('carries the header on a space', () => {
    expect(carveToHtml(`${F}js "T"\nx\n${F}\n`)).toContain('<pre title="T">')
  })

  for (const [name, ws] of [...WIDE, ...MIXED]) {
    it(`is not a fence when the header follows ${name}`, () => {
      const html = carveToHtml(`${F}js${ws}"T"\nx\n${F}\n`)
      expect(html).not.toContain('title="T"')
      // The whole line falls back to prose - it does not silently become a
      // language-only fence with the header quietly dropped.
      expect(html).not.toContain('class="language-js"')
    })
  }

  it('still carries the header across a run of two spaces', () => {
    expect(carveToHtml(`${F}js  "T"\nx\n${F}\n`)).toContain('<pre title="T">')
  })
})

describe("the code fence's label slot takes a space, in both alternatives", () => {
  it('is a fence when the label follows a space', () => {
    expect(carveToHtml(`${F}js "T" [L]\nx\n${F}\n`)).toContain('<pre title="T">')
    expect(carveToHtml(`${F}"T" [L]\nx\n${F}\n`)).toContain('<pre title="T">')
  })

  for (const [name, ws] of [...WIDE, ...MIXED]) {
    it(`is not a fence when the label follows ${name} after a language and header`, () => {
      const html = carveToHtml(`${F}js "T"${ws}[L]\nx\n${F}\n`)
      expect(html).not.toContain('title="T"')
      expect(html).not.toContain('class="language-js"')
    })

    // The label slot appears in two alternatives and is one slot with one role,
    // so both spellings carry the same terminal.
    it(`is not a fence when the label follows ${name} after a bare header`, () => {
      const html = carveToHtml(`${F}"T"${ws}[L]\nx\n${F}\n`)
      expect(html).not.toContain('title="T"')
      expect(html).not.toContain('<pre>')
    })
  }
})

describe("the frontmatter opener's format slot takes a space", () => {
  const body = 'a: 1\n---\nx\n'
  /** Frontmatter is consumed, so the document renders as the body alone. */
  const wasFrontmatter = (html: string) => html.trim() === '<p>x</p>'

  it('opens frontmatter on a space, and on no space at all', () => {
    expect(wasFrontmatter(carveToHtml(`--- yaml\n${body}`))).toBe(true)
    expect(wasFrontmatter(carveToHtml(`---yaml\n${body}`))).toBe(true)
  })

  for (const [name, ws] of [...WIDE, ...MIXED]) {
    it(`does not open frontmatter on ${name}`, () => {
      const html = carveToHtml(`---${ws}yaml\n${body}`)
      expect(wasFrontmatter(html)).toBe(false)
      // The metadata is not silently swallowed either: it stays visible as
      // ordinary content, which is the failure mode PART 7 names.
      expect(html).toContain('a: 1')
    })
  }

  it('still opens frontmatter across a run of two spaces', () => {
    expect(wasFrontmatter(carveToHtml(`---  yaml\n${body}`))).toBe(true)
  })
})

describe("the raw block's format slot takes a space", () => {
  const body = `<b>x</b>\n${F}\n`

  it('opens a raw block on a space, and on no space at all', () => {
    expect(carveToHtml(`${F}=html\n${body}`).trim()).toBe('<b>x</b>')
    expect(carveToHtml(`${F} =html\n${body}`).trim()).toBe('<b>x</b>')
  })

  for (const [name, ws] of [...WIDE, ...MIXED]) {
    it(`does not open a raw block on ${name}`, () => {
      const html = carveToHtml(`${F}${ws}=html\n${body}`)
      // Raw passthrough emits the content verbatim; anything else escapes it.
      expect(html.trim()).not.toBe('<b>x</b>')
      expect(html).toContain('&lt;b&gt;')
    })
  }

  it('still opens a raw block across a run of two spaces', () => {
    expect(carveToHtml(`${F}  =html\n${body}`).trim()).toBe('<b>x</b>')
  })
})

// markdown-migrate keeps its own copy of the frontmatter opener, and its
// docblock states the mirror as the reason: "so a document Carve reads as
// having frontmatter is migrated as having frontmatter." A migrator that reads
// MORE things as frontmatter than the parser does passes the metadata through
// opaquely, and Carve then renders it as body prose after a thematic break -
// which is the leak, not the fallback.
describe('markdownToCarve mirrors the parser on the frontmatter format slot', () => {
  const body = 'a: 1\n---\n\nx\n'

  it('passes a space-separated typed opener through as frontmatter', () => {
    const carve = markdownToCarve(`--- yaml\n${body}`)
    expect(carve).toContain('a: 1\n---')
    expect(carveToHtml(carve).trim()).toBe('<p>x</p>')
  })

  it('sends a tab-separated opener through the body converter instead', () => {
    const carve = markdownToCarve(`---\tyaml\n${body}`)
    // `a: 1` underlined by `---` is a Markdown setext heading. Seeing it
    // converted is the proof the lines took the body path rather than being
    // handed through as an opaque metadata block.
    expect(carve).toContain('## a: 1')
    expect(carve).not.toContain('a: 1\n---')
  })
})
