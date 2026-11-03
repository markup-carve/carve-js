import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// markup-carve/carve#5034: a skipped note definition's body belongs to the note (CARVE-P9-067).
const notes = (n: string): string => `<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a> <a id="fnref2" href="#fn2" role="doc-noteref"><sup>2</sup></a></p>
<section role="doc-endnotes" aria-label="Footnotes">
  <hr>
  <ol>
    <li id="fn1">
      <p>${n}<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
    <li id="fn2">
      <ul>
        <li>l</li>
      </ul>
      <p><a href="#fnref2" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
  </ol>
</section>`

describe('a note plus before a list past a skipped note body', () => {
  it('attaches the list after two lazy lines', () => {
    expect(carveToHtml('[^a]: +\n[^n]: a\n +\n +\n- l\n\nsee[^n] [^a]\n').trim()).toBe(notes('a\n+\n+'))
  })

  it('attaches the list after an indented and a flush lazy line', () => {
    expect(carveToHtml('[^a]: +\n[^n]: a\n x\npara\n- l\n\nsee[^n] [^a]\n').trim()).toBe(notes('a\nx\npara'))
  })
})
