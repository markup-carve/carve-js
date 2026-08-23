import { describe, expect, it } from 'vitest'

import { htmlToCarve } from '../src/index.js'

/**
 * AN ELEMENT CONSUMED FOR ITS CHILDREN STILL REPORTS ITS OWN ATTRIBUTES
 * (markup-carve/carve-js#1332).
 *
 * A caption line holds inline content and has no attribute slot, so a
 * `<figcaption>` and a table `<caption>` are read for their CHILDREN and the
 * element itself contributes no node. Every caption site read `childNodes`
 * straight past the element, so its attributes were never looked at: an
 * `onclick` on a `<figcaption>` was stripped - correctly - and never mentioned.
 *
 * A SILENT DROP IS THE ONE FAILURE MODE THE REPORT EXISTS TO PREVENT, and it is
 * worse than a wrong path: a wrong path is visible and gets fixed, a missing row
 * reads as "nothing was dropped". carve-php and carve-rs both reported these;
 * this engine alone did not, and no fixture covered the shape, which is why
 * three engines disagreed in silence.
 *
 * THE FIX IS THE CATEGORY. The importer already had the answer for a `<dt>`, a
 * `<dd>`, a `<dl>` group wrapper and a `<summary>` - route the element through
 * `attrs()` for its diagnostics even though the model has nowhere to put the
 * result. The caption slots were simply never wired to that helper. Naming
 * `<figcaption>` would have fixed the reported case and left the table caption
 * exactly as silent, which the table rows below are here to prove.
 */
describe('an element consumed for its children reports its own attributes', () => {
  /*
   * THE REPORTED CASE and its neighbours. The table caption rows are NOT the
   * ticket's example: they were found by sweeping the importer for other
   * elements read through `childNodes`, and they were silent here for the same
   * reason and in the same way.
   */
  const silent: Array<[string, string, string]> = [
    [
      'a figcaption event handler',
      '<figure><img src="i.png"><figcaption onclick="x()">c</figcaption></figure>',
      '/figure[1]/figcaption[2]',
    ],
    [
      'a figcaption id and class',
      '<figure><img src="i.png"><figcaption id="cap" class="c">c</figcaption></figure>',
      '/figure[1]/figcaption[2]',
    ],
    [
      'a table caption event handler',
      '<table><caption onclick="x()">c</caption><tr><td>a</td></tr></table>',
      '/table[1]/caption[1]',
    ],
    [
      'a table caption id and class',
      '<table><caption id="tc" class="k">c</caption><tr><td>a</td></tr></table>',
      '/table[1]/caption[1]',
    ],
    [
      "a composite figure group's own caption",
      '<figure class="carve-figure-group"><div class="carve-figure-panels">' +
        '<figure class="carve-figure-panel"><img src="a.png"><figcaption>p</figcaption></figure>' +
        '</div><figcaption onclick="x()">g</figcaption></figure>',
      '/figure[1]/figcaption[2]',
    ],
  ]

  for (const [label, html, path] of silent) {
    it(`says so when it drops ${label}`, () => {
      const dropped = htmlToCarve(html).report.diagnostics.filter(
        (d) => d.code === 'attribute-dropped',
      )
      expect(dropped.length).toBeGreaterThan(0)
      // The path carve-php and carve-rs both print for the same input.
      expect(dropped.map((d) => d.path)).toContain(path)
    })
  }

  /*
   * THE SIXTH SITE, and the only one where the element goes WHOLE. A figure
   * wrapping a table that carries its own `<caption>` drops the `<figcaption>`
   * entirely - `table-degraded` says so, and says nothing about what rode on
   * it, so an attribute there was stripped with no `attribute-dropped` row.
   * That is the same silence as the other five, reached by a different path.
   */
  it('says so when it drops a figcaption with the figure-wrapped table it captioned', () => {
    const html =
      '<figure><table><caption>t</caption><tr><td>a</td></tr></table>' +
      '<figcaption onclick="x()">c</figcaption></figure>'
    const codes = htmlToCarve(html).report.diagnostics.map((d) => d.code)
    expect(codes).toContain('table-degraded')
    expect(codes).toContain('attribute-dropped')
  })

  it('names the element rather than the slot when the caption goes whole', () => {
    // The wording differs from the other five on purpose: nothing was refused
    // for want of a slot, the element it would have ridden on is gone.
    const html =
      '<figure><table><caption>t</caption><tr><td>a</td></tr></table>' +
      '<figcaption id="q">c</figcaption></figure>'
    const dropped = htmlToCarve(html).report.diagnostics.find(
      (d) => d.code === 'attribute-dropped',
    )
    expect(dropped?.message).toBe(
      'Dropped id with the <figcaption>: the element itself is not kept',
    )
  })

  it('still drops the attribute it reports', () => {
    // The report is a record of a loss, not a licence to keep the value: an
    // event handler on a caption is stripped here exactly as it always was.
    const result = htmlToCarve(
      '<figure><img src="i.png"><figcaption onclick="x()">c</figcaption></figure>',
    )
    expect(result.value).not.toContain('onclick')
    expect(result.value).toBe('![](i.png)\n^ c\n')
  })

  it('reports nothing for a caption that carries nothing', () => {
    // The helper reports what `attrs()` returns, so a bare caption is silent -
    // an unconditional row would be the mirror defect, a report claiming a drop
    // that never happened (markup-carve/carve-php#1579).
    const result = htmlToCarve('<figure><img src="i.png"><figcaption>c</figcaption></figure>')
    expect(result.report.diagnostics).toEqual([])
  })

  it('names the caption line as the slot that could not hold it', () => {
    const [dropped] = htmlToCarve(
      '<figure><img src="i.png"><figcaption id="cap">c</figcaption></figure>',
    ).report.diagnostics
    expect(dropped?.message).toBe('Dropped id on <figcaption>: a caption line has no attribute slot')
  })
})
