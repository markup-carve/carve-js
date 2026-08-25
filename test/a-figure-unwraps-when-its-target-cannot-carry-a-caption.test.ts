/*
 * In `safe` and `semantic`, a figure whose target cannot CARRY a caption line
 * unwraps and declares, instead of writing a line the target will absorb
 * (ruling markup-carve/carve-php#1731).
 *
 * THE ASSERTION THAT MATTERS IS ON THE RE-RENDER, not on the emitted Carve. A
 * test that pinned only the string would pass an implementation that still
 * writes `^ Cap` under prose, and that is exactly the defect: `^ Cap` is a
 * caption line only when the block above it can carry a caption, so a bare
 * paragraph reads it as more of the same paragraph and the caret survives as a
 * literal character. The document gains a `^` nobody typed, and no diagnostic
 * said so. Every row below therefore asserts that no caret reaches the rendered
 * text, alongside the source it was written from.
 *
 * THE SET IS A PROPERTY, NOT A TAG LIST. `FIGURE_REBUILDS` answers for every
 * mode; the modes differ only in what they do with a target outside it, which
 * `roundtrip-rebuilds-a-figure-only-when-carve-spells-it.test.ts` pins on the
 * other side. So a paragraph and a `<div>` body take the same exit here without
 * either being named, and a caption target added later inherits both halves.
 */
import { describe, expect, it } from 'vitest'
import { carveToHtml, htmlToCarve } from '../src/index.js'

const PARAGRAPH = '<figure id="f" class="c"><p>x</p><figcaption>Cap</figcaption></figure>'
const DIV = '<figure id="f" class="c"><div>x</div><figcaption>Cap</figcaption></figure>'
const LIST = '<figure id="f" class="c"><ul><li>x</li></ul><figcaption>Cap</figcaption></figure>'
const MATH = '<figure id="f" class="c"><p><span class="math display">\\[x\\]</span></p><figcaption>Cap</figcaption></figure>'
const IMAGE = '<figure id="f" class="c"><img src="a.png" alt="A"><figcaption>Cap</figcaption></figure>'
const QUOTE = '<figure id="f" class="c"><blockquote><p>q</p></blockquote><figcaption>Cap</figcaption></figure>'
const CODE = '<figure id="f" class="c"><pre><code>q</code></pre><figcaption>Cap</figcaption></figure>'

const MODES = ['safe', 'semantic'] as const

const importOf = (html: string, mode: (typeof MODES)[number]) => {
  const result = htmlToCarve(html, { mode })
  return {
    carve: result.value,
    codes: result.report.diagnostics.map((d) => d.code),
    severities: result.report.diagnostics.map((d) => d.severity),
    rendered: carveToHtml(result.value),
  }
}

describe('a figure unwraps when its target cannot carry a caption', () => {
  /*
   * The reported shape, byte for byte against carve-php, which is the engine
   * that had it right: body, blank line, caption as its own paragraph.
   */
  it.each(MODES)('unwraps a paragraph figure in %s and declares what it cost', (mode) => {
    const { carve, codes, severities } = importOf(PARAGRAPH, mode)
    expect(carve).toBe('x\n\nCap\n')
    // ONE ROW PER ATTRIBUTE the wrapper carried, at `info`, which is what the
    // ruling named and what carve-php and carve-rs both emit from this input.
    expect(codes).toEqual(['element-unwrapped', 'attribute-dropped', 'attribute-dropped'])
    expect(severities).toEqual(['info', 'info', 'info'])
  })

  /*
   * A `<div>` body is the same shape reached by a different tag: it imports to
   * a paragraph, so it takes the paragraph's exit without the tag appearing
   * anywhere in the rule.
   */
  it.each(MODES)('unwraps a div-bodied figure in %s for the same reason', (mode) => {
    expect(importOf(DIV, mode).carve).toBe('x\n\nCap\n')
  })

  /*
   * DISPLAY MATH IS A PARAGRAPH AND TAKES THE PARAGRAPH'S ANSWER. `roundtrip`
   * already preserves this shape rather than rebuilding it, so treating it as
   * captionable in the lossy modes would have split one rule across the modes;
   * carve-php unwraps it too.
   */
  it.each(MODES)('unwraps a display-math figure in %s', (mode) => {
    expect(importOf(MATH, mode).carve).toBe('$$`x`\n\nCap\n')
  })

  /*
   * The list was already unwrapping and declaring before the ruling. It is here
   * as the control: the engine used to warn loudest on the harmless case and
   * say nothing at all on the one that corrupted the text.
   */
  it.each(MODES)('leaves the list figure on the unwrap it already took in %s', (mode) => {
    const { carve, codes, severities } = importOf(LIST, mode)
    expect(carve).toBe('- x\n\nCap\n')
    expect(codes).toEqual(['element-unwrapped', 'attribute-dropped', 'attribute-dropped'])
    expect(severities).toEqual(['info', 'info', 'info'])
  })

  /*
   * THE CARET IS THE WHOLE POINT. Zero diagnostics used to accompany a rendered
   * `<p id="f" class="c">x ^ Cap</p>`; nothing this importer writes may put a
   * character into the text that the author did not.
   */
  it.each([
    ['paragraph', PARAGRAPH],
    ['div body', DIV],
    ['display math', MATH],
    ['list', LIST],
  ])('writes no caret into the rendered text around a %s', (_name, html) => {
    for (const mode of MODES) expect(importOf(html, mode).rendered).not.toContain('^')
  })

  /*
   * The targets that CAN carry a caption keep the rebuild, in these modes as in
   * `roundtrip`: the caption line re-parses to the figure it was written from,
   * so the element survives and there is nothing to declare.
   */
  it.each([
    ['image', IMAGE],
    ['blockquote', QUOTE],
    ['code block', CODE],
  ])('still rebuilds a %s figure, whose caption line binds', (_name, html) => {
    for (const mode of MODES) {
      const { codes, rendered } = importOf(html, mode)
      expect(codes).toEqual([])
      expect(rendered).toContain('<figcaption>Cap</figcaption>')
    }
  })

  /*
   * THE ATTRIBUTES GO, DELIBERATELY. Landing the figure's `id` on the paragraph
   * would keep an anchor resolvable at one fewer declared loss, and it was
   * considered and rejected: the id identified a figure, and a bare paragraph
   * wearing it identifies something the author never marked.
   */
  it.each(MODES)('drops the wrapper attributes rather than moving them onto the body in %s', (mode) => {
    const { carve, rendered } = importOf(PARAGRAPH, mode)
    expect(carve).not.toContain('{#f')
    expect(rendered).not.toContain('id="f"')
  })

  /*
   * `roundtrip` is untouched by this ruling: it can keep the bytes, so it does
   * (markup-carve/carve#1704).
   */
  it('leaves roundtrip preserving the whole element', () => {
    const result = htmlToCarve(PARAGRAPH, { mode: 'roundtrip' })
    expect(result.value).toBe('```=html\n' + PARAGRAPH + '\n```\n')
    expect(result.report.diagnostics.map((d) => d.code)).toEqual(['raw-preserved'])
  })
})
