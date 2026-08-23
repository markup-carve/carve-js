import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, renderCarve } from '../src/index.js'

// markup-carve/carve-js#1356, markup-carve/carve#1581.
//
// A HEADING'S MARKER SEPARATOR IS ASCII SPACES AND NOTHING ELSE, so the first
// character that is not a space begins the heading text and a TAB standing
// there is CONTENT. The parser here has always read it that way; the writer
// did not, and trimmed the tab off with the separator run. That makes
// `carveToCarve` say something the input did not - PART 11 §1 forbids it at
// both strengths, `parse(fmt(x)) == parse(x)` and the weaker
// `to_html(fmt(x)) == to_html(x)`.
//
// BOTH RENDERS ARE PLAUSIBLE HTML, which is what let this survive: `<h2>x</h2>`
// looks like every other heading. Only a BYTE comparison of the two renders
// catches it, so that is what these assertions do.
//
// The corpus pins the shape at
// `406-a-heading-s-marker-separator-is-a-run-and-none-of-it-is-content-3`, and
// the spec repo declared it in `resources/engine-fmt-drift.txt` against this
// issue until the fix landed.

const TAB = '\t'

/** `carveToHtml(src)` and `carveToHtml(carveToCarve(src))`, byte for byte. */
const bothRenders = (src: string): [string, string] => [
  carveToHtml(src),
  carveToHtml(carveToCarve(src)),
]

describe("a heading's leading tab survives the writer", () => {
  it('writes the tab back rather than folding it into the separator', () => {
    expect(carveToCarve(`## ${TAB}x\n`)).toBe(`## ${TAB}x\n`)
    expect(carveToCarve(`# ${TAB}x\n`)).toBe(`# ${TAB}x\n`)
  })

  it('renders the same bytes before and after the writer', () => {
    for (const src of [`# ${TAB}x\n`, `## ${TAB}x\n`, `### ${TAB}x${TAB}y\n`]) {
      const [before, after] = bothRenders(src)
      expect(after).toBe(before)
      expect(before).toContain('<h')
      expect(before).toContain(`>${TAB}`)
    }
  })

  it('is idempotent', () => {
    const once = carveToCarve(`## ${TAB}x\n`)
    expect(carveToCarve(once)).toBe(once)
  })

  it('still drops the separator run itself, which a re-parse gives back', () => {
    // The SPACES are not content: a re-parse folds every one of them back into
    // the separator, so writing them would only be a longer spelling of the
    // same document (PART 11 §2).
    expect(carveToCarve('#  x\n')).toBe('# x\n')
    expect(carveToCarve('#     x\n')).toBe('# x\n')
    const [before, after] = bothRenders('#     x\n')
    expect(after).toBe(before)
  })

  it('still drops the trailing run, which PART 2 discards before the heading is read', () => {
    expect(carveToCarve(`## x${TAB}\n`)).toBe('## x\n')
    const [before, after] = bothRenders(`## x${TAB}\n`)
    expect(after).toBe(before)
  })

  it('keeps the first tab of a mixed leading run and drops the spaces around it', () => {
    expect(carveToCarve(`##  ${TAB} a \n`)).toBe(`## ${TAB} a\n`)
    const [before, after] = bothRenders(`##  ${TAB} a \n`)
    expect(after).toBe(before)
  })

  it('keeps a constructed leading tab too', () => {
    const doc = {
      type: 'doc',
      children: [
        {
          type: 'heading',
          level: 2,
          children: [{ type: 'text', value: `${TAB}x` }],
        },
      ],
    }
    expect(renderCarve(doc as never)).toBe(`## ${TAB}x\n`)
  })

  describe('CONTROL: the neighbouring constructs are unchanged', () => {
    it('a caption keeps its leading tab, as it already did', () => {
      const src = `^ ${TAB}second\n`
      expect(carveToCarve(src)).toBe(src)
      const [before, after] = bothRenders(src)
      expect(after).toBe(before)
    })

    it("a bullet's leading tab is structural and stays dropped", () => {
      // It never reaches the item's content, so there is nothing to keep
      // (markup-carve/carve#698).
      expect(carveToCarve(`- ${TAB}x\n`)).toBe('- x\n')
      const [before, after] = bothRenders(`- ${TAB}x\n`)
      expect(after).toBe(before)
    })
  })
})
