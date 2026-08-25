/*
 * An unwrapped `<figure>` reports the way every other unwrapped element does:
 * `element-unwrapped`, `info`, `Unwrapped unsupported <figure> element`
 * (ruling markup-carve/carve#1716).
 *
 * THE SUBJECT IS THE FIRING SURFACE, NOT THE TWO STRINGS THAT MOVED. A wording
 * and severity change is a rename until something proves the row still fires
 * where it fired before; a fix that quietly stopped reporting some unwrapped
 * figure would trade a cosmetic divergence for a silent loss, which is the
 * failure this series exists to remove. So the tables below enumerate every
 * shape that reached either call site BEFORE the change - measured on the
 * parent commit, in all three modes - and assert each one still reports. The
 * shapes that reported nothing then are listed too, because broadening the row
 * is as much a change as narrowing it.
 *
 * ALL THREE MODES, because the two call sites are reached differently in each:
 * `roundtrip` preserves a captioned figure it cannot rebuild as raw HTML rather
 * than unwrapping it (markup-carve/carve#1704), so the `UNWRAPS_OUTSIDE_ROUNDTRIP`
 * shapes report in `safe` and `semantic` and are silent in `roundtrip`. An earlier
 * draft of this file passed a mode name that is not one of the three; the
 * import took it, behaved like none of them, and the file measured a surface
 * the library does not have. `HtmlImportMode` is named here so a typo is a type
 * error rather than a phantom fourth mode.
 *
 * THE OLD SPLIT IS PINNED AS ABSENT. carve-js used to say one thing when the
 * target was one it can write a caption line for and another when it was not,
 * so a consumer saw text that tracked this engine's target set rather than the
 * document. Both arms now say the same sentence, and the last case asserts the
 * distinct set of rows over the whole surface has exactly one member - which
 * fails if a later arm reintroduces a figure-specific wording or severity.
 */
import { describe, expect, it } from 'vitest'
import type { HtmlImportMode } from '../src/index.js'
import { htmlToCarve } from '../src/index.js'

const MESSAGE = 'Unwrapped unsupported <figure> element'
const ROW = `info :: ${MESSAGE}`
const MODES: HtmlImportMode[] = ['safe', 'semantic', 'roundtrip']

const rows = (html: string, mode: HtmlImportMode) =>
  htmlToCarve(html, { mode })
    .report.diagnostics.filter((d) => d.code === 'element-unwrapped')
    .map((d) => `${d.severity} :: ${d.message}`)

/*
 * NOT A FIGURE, SO IT UNWRAPS IN EVERY MODE. A figure is the CAPTIONED wrapper
 * (PART 9 §4b), so an element with no `<figcaption>`, or one whose caption
 * spells nothing, has nothing to build a figure from and nothing to preserve.
 * Every captionable target is listed because the arm is reached through
 * `captionHost`, and a target added to that set later should inherit the row
 * rather than quietly slip past it - together with the one uncaptioned shape
 * whose body no caption line attaches to, which reaches the other call site.
 */
const UNWRAPS_IN_EVERY_MODE: Array<[string, string]> = [
  ['an image, no figcaption at all', '<figure><img src="a.png" alt="A"></figure>'],
  ['an image, empty figcaption', '<figure><img src="a.png" alt="A"><figcaption></figcaption></figure>'],
  ['a quote, blank figcaption', '<figure><blockquote><p>q</p></blockquote><figcaption>   </figcaption></figure>'],
  ['a code block, empty figcaption', '<figure><pre><code>x</code></pre><figcaption></figcaption></figure>'],
  ['a paragraph, empty figcaption', '<figure><p>body</p><figcaption></figcaption></figure>'],
  ['a table, empty figcaption', '<figure><table><tr><td>c</td></tr></table><figcaption></figcaption></figure>'],
  ['an inner figure carrying no caption of its own', '<figure><figure><img src="a.png"></figure><figcaption>Cap</figcaption></figure>'],
  ['a list, uncaptioned, which no caption line attaches to', '<figure><ul><li>a</li></ul></figure>'],
]

/*
 * A CAPTION THIS ENGINE CANNOT WRITE ON THE BODY. `safe` and `semantic` unwrap
 * and report; `roundtrip` keeps the element as raw HTML instead, so the figure
 * survives and there is nothing to report. Both halves are pinned so the modes
 * are not silently assumed to agree.
 */
const UNWRAPS_OUTSIDE_ROUNDTRIP: Array<[string, string]> = [
  ['a list', '<figure><ul><li>a</li></ul><figcaption>Cap</figcaption></figure>'],
  ['a heading', '<figure><h2>H</h2><figcaption>Cap</figcaption></figure>'],
  ['a list, with attributes to place', '<figure id="f"><ul><li>a</li></ul><figcaption>Cap</figcaption></figure>'],
  // THE THREE ROWS THIS FILE PINNED AS SILENT, now reporting. They were listed
  // as a bounded absence, with the note that carve-rs and carve-php reported
  // shapes carve-js did not - a disagreement about WHETHER the row fires, left
  // for a later ruling. markup-carve/carve-php#1731 is that ruling: a target
  // that cannot carry a caption line unwraps in the lossy modes rather than
  // writing a line the target absorbs, so each of these reaches the unwrap and
  // says the same one sentence as every other.
  ['a paragraph', '<figure id="f"><p>x</p><figcaption>Cap</figcaption></figure>'],
  ['two body blocks under one caption', '<figure><p>a</p><p>b</p><figcaption>Cap</figcaption></figure>'],
  ['a div body', '<figure><div>x</div><figcaption>Cap</figcaption></figure>'],
]

describe('an unwrapped figure reports like every other unwrapped element', () => {
  describe.each(MODES)('in %s mode', (mode) => {
    it.each(UNWRAPS_IN_EVERY_MODE)('reports a figure that is not a figure: %s', (_name, html) => {
      expect(rows(html, mode)).toEqual([ROW])
    })

  })

  describe.each(['safe', 'semantic'] as HtmlImportMode[])('in %s mode', (mode) => {
    it.each(UNWRAPS_OUTSIDE_ROUNDTRIP)('reports a captioned figure it cannot build from: %s', (_name, html) => {
      expect(rows(html, mode)).toEqual([ROW])
    })
  })

  it.each(UNWRAPS_OUTSIDE_ROUNDTRIP)('preserves rather than unwraps the same shape in roundtrip: %s', (_name, html) => {
    expect(rows(html, 'roundtrip')).toEqual([])
    expect(htmlToCarve(html, { mode: 'roundtrip' }).report.diagnostics.map((d) => d.code)).toContain('raw-preserved')
  })

  /*
   * THE SPLIT IS GONE, AND CANNOT REGROW UNNOTICED. Across the whole surface
   * above, in all three modes, the row emits exactly one distinct severity and
   * one distinct message. An arm added later that says something
   * figure-specific, or rates one target's loss higher than another's, fails
   * here rather than in a cross-engine comparison months later.
   */
  it('says one thing at one severity across the whole surface', () => {
    const seen = new Set<string>()
    for (const mode of MODES) {
      for (const [, html] of [...UNWRAPS_IN_EVERY_MODE, ...UNWRAPS_OUTSIDE_ROUNDTRIP]) {
        for (const row of rows(html, mode)) seen.add(row)
      }
    }
    expect([...seen]).toEqual([ROW])
  })

  /*
   * The row naming what happened to the ELEMENT stands ahead of the row naming
   * what became of the attributes that had nowhere left to go, which is the
   * order both sibling engines report and the reason carve-php placed its own
   * row before the attribute loop (carve-php#1725). The event-handler row is
   * not part of that ordering: it is written while the attributes are read,
   * before any element handler is entered, and it reports what SURVIVED rather
   * than what the unwrap cost.
   */
  it('reports the element before the attributes it could not place', () => {
    const messages = htmlToCarve('<figure id="f" onclick="x()"><ul><li>a</li></ul><figcaption>Cap</figcaption></figure>', { mode: 'safe' }).report.diagnostics.map(
      (d) => `${d.code} :: ${d.message}`,
    )
    const element = messages.findIndex((m) => m === `element-unwrapped :: ${MESSAGE}`)
    const unplaceable = messages.findIndex((m) => m.startsWith('attribute-dropped :: Dropped id with the unwrapped <figure>'))
    expect(element).toBeGreaterThanOrEqual(0)
    expect(unplaceable).toBeGreaterThan(element)
  })
})
