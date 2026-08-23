import { describe, expect, it } from 'vitest'
import { htmlToCarve } from '../src/index.js'

/*
 * PART 12 §16, markup-carve/carve#1554.
 *
 * The two halves of the path clause are one rule: there is no step for a
 * wrapper the importer added, and a step's index counts among ALL of the
 * children of the parent that step SITS UNDER. Where a bare inline run is
 * wrapped in a synthesized paragraph both apply at once, and this engine
 * applied only the first - it dropped the wrapper step and then numbered the
 * run inside the wrapper anyway, so the index named a parent no step spells.
 *
 * The defect was invisible for exactly as long as the shared fixture encoded
 * it: `math-block-and-mathml` stated `/math[1]`, this engine and carve-rs
 * agreed with it, and carve-php - which followed the clause - was the only one
 * red. The tell was one diagnostic later in the SAME document: `/p[3]/math[2]`
 * counts the `<div>` and the `<math>` that `/math[1]` did not.
 *
 * Not a math test. Any diagnostic on a bare inline run the importer wraps was
 * numbered wrong, so `<kbd>` leads here and math follows it.
 */
const pathsOf = (html: string): string[] => htmlToCarve(html).report.diagnostics.map((d) => d.path ?? '')

describe('a diagnostic on a wrapped inline run', () => {
  it('counts among the body children, not inside the synthesized paragraph', () => {
    expect(pathsOf('<p>z</p><kbd onclick="x()">K</kbd>')).toEqual(['/kbd[2]'])
  })

  it('counts a block sibling that produced no wrapper of its own', () => {
    expect(pathsOf('<hr><math alttext="a"></math>')).toEqual(['/math[2]'])
  })

  it('counts every preceding body child', () => {
    expect(pathsOf('<p>z</p><p>y</p><math alttext="a"></math>')).toEqual(['/math[3]'])
  })

  /*
   * The buffer is not a contiguous window onto the child list either: a
   * whitespace-only text node before the run is dropped rather than buffered,
   * so an offset from where the buffer starts is not the index the step needs.
   * Here the run holds a text node of its own, which the index must count.
   */
  it('counts a text node the run itself begins with', () => {
    expect(pathsOf('<p>z</p>lead text<math alttext="a"></math>')).toEqual(['/math[3]'])
  })

  it('counts inside a container the same way', () => {
    expect(pathsOf('<div><p>z</p><kbd onclick="x()">K</kbd></div>')).toEqual(['/div[1]/kbd[2]'])
    expect(pathsOf('<blockquote><p>z</p><kbd onclick="x()">K</kbd></blockquote>')).toEqual(['/blockquote[1]/kbd[2]'])
  })

  /*
   * The cases that already agreed, kept so a fix that moves them fails: none of
   * these wraps anything, and their indices were right before this change.
   */
  it('leaves a run that needed no wrapper where it was', () => {
    expect(pathsOf('lead text<p onclick="x()">t</p>')).toEqual(['/p[2]'])
    expect(pathsOf('<!-- c --><math alttext="a"></math>')).toEqual(['/math[2]'])
    expect(pathsOf('<p>lead <em>e</em> <kbd onclick="x()">K</kbd></p>')).toEqual(['/p[1]/kbd[4]'])
  })
})

/*
 * The same rule, found by the sweep the ruling asked for: a `<figure>` lifts
 * its caption out of the child list, and both the caption's own step and the
 * body it leaves behind were numbered against the FILTERED list rather than
 * against the figure's children.
 */
describe('a figure numbers its children where the author put them', () => {
  it('does not renumber the body when the caption is lifted out', () => {
    expect(pathsOf('<figure><figcaption>c</figcaption><img src="i.png" onclick="x()"></figure>')).toEqual([
      '/figure[1]/img[2]',
    ])
  })

  it('gives the caption its own position rather than a literal first', () => {
    expect(pathsOf('<p>a</p><figure><img src="i.png"><figcaption>c <kbd onclick="x()">K</kbd></figcaption></figure>')).toEqual([
      '/figure[2]/figcaption[2]/kbd[2]',
    ])
  })

  it('counts the whitespace text nodes of a pretty-printed figure', () => {
    expect(pathsOf('<figure>\n<img src="i.png">\n<figcaption>c <kbd onclick="x()">K</kbd></figcaption>\n</figure>')).toEqual([
      '/figure[1]/figcaption[4]/kbd[2]',
    ])
  })
})
