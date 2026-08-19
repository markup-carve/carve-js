import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

/**
 * PART 11 §1: `to_html(fmt(x)) == to_html(x)`.
 *
 * A frontmatter block is an opening fence AT BYTE 0 plus a bare `---` CLOSER
 * anywhere below it. So a `---`-shaped line at the head of the emitted document
 * is only a hazard when something later closes it, which makes the collision a
 * property of the WHOLE emitted text rather than of its first line.
 *
 * Two unrelated writer decisions can put a `---` there:
 *
 * - an authored `---` break can open the emitted document and gain a closer
 *   from any later break (markup-carve/carve-js#899).
 * - a hoisted link or footnote definition is written after the body, promoting
 *   whatever stood second to byte 0 (markup-carve/carve-js#901). Nothing is
 *   respelled there, so fixing the first cause does not fix this one.
 *
 * And a third shape neither ticket names: the promoted block can be a PARAGRAPH
 * whose first line is `---yaml`-shaped. No head-of-document respelling repairs
 * that one, because the paragraph's text is not the writer's to change - it is
 * saved by respelling the CLOSER instead.
 *
 * All three are decided by handing the FINISHED BYTES to the parser's own
 * frontmatter test, in one seam, which is what carve-rs does.
 */

/** `fmt` preserved the rendering, and is idempotent. */
function roundTrips(src: string): boolean {
  const once = carveToCarve(src)
  return carveToHtml(once) === carveToHtml(src) && carveToCarve(once) === once
}

describe('the Carve writer does not manufacture a frontmatter block', () => {
  it('different authored markers need no frontmatter fallback', () => {
    expect(carveToCarve('***\n\n---\n')).toBe('***\n\n---\n')
    expect(carveToHtml('***\n\n---\n')).toBe('<hr>\n<hr>')
    expect(roundTrips('***\n\n---\n')).toBe(true)
  })

  it('keeps the blocks between two breaks', () => {
    const src = '***\n\na\n\n---\n\nb\n'
    expect(carveToHtml(src)).toBe('<hr>\n<p>a</p>\n<hr>\n<p>b</p>')
    expect(roundTrips(src)).toBe(true)
    // `a` survived: it was frontmatter content before.
    expect(carveToHtml(carveToCarve(src))).toContain('<p>a</p>')
  })

  it('every spelling of the leading break is covered', () => {
    for (const opener of ['***', '___', '---']) {
      expect(roundTrips(`${opener}\n\na\n\n---\n\nb\n`)).toBe(true)
    }
  })

  it('CONTROL: a leading break with no later break keeps its authored marker', () => {
    expect(carveToCarve('***\n\npara\n')).toBe('***\n\npara\n')
    expect(carveToCarve('---\n\npara\n')).toBe('---\n\npara\n')
  })

  it('CONTROL: real frontmatter is still written as frontmatter', () => {
    expect(carveToCarve('---yaml\nk: v\n---\n\nb\n')).toBe('---yaml\nk: v\n---\n\nb\n')
    expect(roundTrips('---yaml\nk: v\n---\n\n***\n\nb\n')).toBe(true)
  })

  it('a hoisted link definition does not promote a `---` block to byte 0', () => {
    const src = '[a]: /u\n\n---\n\np\n\n---\n'
    // The input already held `---`; the fallback protects the hoisted shape.
    expect(carveToHtml(src)).toBe('<hr>\n<p>p</p>\n<hr>')
    expect(roundTrips(src)).toBe(true)
    expect(carveToCarve(src)).toBe('***\n\np\n\n***\n\n[a]: /u\n')
  })

  it('a hoisted footnote definition promoting a `---yaml`-shaped PARAGRAPH', () => {
    // The head cannot be respelled as a BREAK - it is the paragraph's own text
    // - so it is escaped instead, which is what carve#1443 changed here: the
    // run is now literal `---` rather than an em dash, and a bare `---yaml` at
    // byte 0 would open frontmatter. Escaping the head is enough on its own, so
    // the closer keeps the `---` the author wrote.
    const src = '[^a]: n\n\n---yaml\nk: v\n---\n'
    expect(roundTrips(src)).toBe(true)
    expect(carveToCarve(src)).toBe('\\-\\-\\-yaml\nk: v\n\n---\n\n[^a]: n\n')
  })

  it('CONTROL: an abbreviation definition is not hoisted, and never was', () => {
    // A definition too, and it stays put - so the defect is the RELOCATION, not
    // definitions in general.
    expect(carveToCarve('*[T]: e\n\np\n')).toBe('*[T]: e\n\np\n')
    expect(roundTrips('*[T]: e\n\n---\n\np\n\n---\n')).toBe(true)
  })

  it('is idempotent: the fallback spelling is stable under a second pass', () => {
    const once = carveToCarve('***\n\na\n\n---\n\nb\n')
    expect(carveToCarve(once)).toBe(once)
    expect(carveToCarve(carveToCarve(once))).toBe(once)
  })

  it('keeps the authored marker when the fallback would buy nothing', () => {
    // The closer here is the `---` INSIDE a code fence, which frontmatter is
    // consumed ahead of - so no break spelling repairs this document, and the
    // writer does not pay a respelling that changes nothing. This row is what
    // makes the second `opensFrontmatter` call load-bearing rather than
    // decorative; it is a KNOWN residual of §1, not a case this fix claims.
    // The head is escaped since carve#1443 made the run literal text, which is
    // what keeps the document safe here - the marker itself is still the one
    // the author wrote.
    const src = '[^a]: n\n\n---yaml\nk: v\n\n```\n---\n```\n\n***\n'
    expect(carveToCarve(src)).toBe('\\-\\-\\-yaml\nk: v\n\n```\n---\n```\n\n***\n\n[^a]: n\n')
  })

  it('a break inside a container is respelled with the rest', () => {
    // The fallback is document-wide, so a break that is not at the head moves
    // too. It has to still parse as a break wherever it lands.
    const src = '***\n\n> ---\n\n---\n'
    expect(roundTrips(src)).toBe(true)
    expect(carveToHtml(carveToCarve(src))).toBe(carveToHtml(src))
  })
})
