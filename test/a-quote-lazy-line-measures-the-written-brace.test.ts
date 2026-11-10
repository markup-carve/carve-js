/*
 * carve#5820 (ruling A): a quote's lazy line continues a brace run only past
 * the document column its `{` is written at, quote prefixes included
 * (CARVE-P2-035). Expected outputs are the spec model's at carve c9a8c603.
 */

import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const note = (body: string): string =>
  '<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n' +
  '<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n' +
  body +
  '<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>'

const CASES: Array<[string, string]> = [
  // Row 1029: the `{` is written at column 2, the lazy line at 1.
  ['> [^a]: +\n> {#i\n .y}\n\nsee[^a]\n', '<blockquote>\n\n</blockquote>\n' + note('      <p>{<span class="tag"><strong>#i</strong></span>\n.y}')],
  ['> [^a]: +\n> {.x\n  .y}\n\nsee[^a]\n', '<blockquote>\n\n</blockquote>\n' + note('      <p>{.x\n.y}')],
  // A tab before the quote marker counts to the next tab stop: the `{` is at 6.
  ['\t> [^a]: +\n\t> {#i\n      .y}\n\nsee[^a]\n', '<blockquote>\n\n</blockquote>\n' + note('      <p>{<span class="tag"><strong>#i</strong></span>\n.y}')],
  // Past the written `{` the continuation is still a lazy line, which refuses the run (carve#5830 rule B).
  ['> [^a]: +\n> {.x\n   .y}\n\nsee[^a]\n', '<blockquote>\n\n</blockquote>\n' + note('      <p>{.x\n.y}')],
  ['> > [^a]: +\n> > {.x\n    .y}\n\nsee[^a]\n', '<blockquote>\n  <blockquote>\n\n  </blockquote>\n</blockquote>\n' + note('      <p>{.x\n.y}')],
  // A refused run is paragraph text read by the inline rules, so `#i` is a tag (carve#5830 rule A).
  ['> {#i\n .y}\n', '<blockquote><p>{<span class="tag"><strong>#i</strong></span>\n.y}</p></blockquote>'],
  ['> > {#i\n   .y}\n', '<blockquote>\n  <blockquote><p>{<span class="tag"><strong>#i</strong></span>\n.y}</p></blockquote>\n</blockquote>'],
  ['> {.x\n   .y}\n', '<blockquote><p>{.x\n.y}</p></blockquote>'],
]

describe('a quote lazy line measures the written brace (carve#5820)', () => {
  for (const [source, html] of CASES) {
    it(JSON.stringify(source), () => {
      expect(carveToHtml(source).trim()).toBe(html)
    })
  }
})
