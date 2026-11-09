import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('leaves a wrapped attribute run outside a quoted note when it misses the note marker (carve#5622)', () => {
  expect(carveToHtml('> [^a]: +\n>   {#i\n>    .y}\nnext\n\nsee[^a]\n')).toBe(
    '<blockquote>\n\n</blockquote>\n' +
    '<p>next</p>\n' +
    '<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n' +
    '<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n' +
    '    <li id="fn1">\n      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n' +
    '    </li>\n  </ol>\n</section>')
})

it.each(['> >   {#i}', '> >   {#i\n> >    .y}'])(
  'closes nested quotes after a refused note plus and attribute run %s',
  run => {
    const html = carveToHtml(`> > [^a]: +\n${run}\nnext\n\nsee[^a]\n`)
    expect(html).toContain('</blockquote>\n<p>next</p>')
  },
)
