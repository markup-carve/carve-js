import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve#5890 ruling B: after a refused `+` ends a note's attached list, a line at the
// note's body column belongs to the note and opens a new block there.

it('opens a second list in a stacked note after a fence', () => {
  expect(carveToHtml('- [^a]: +\n  - li\n    ```\n  +\n    - x\n\nsee[^a]\n').trim()).toBe([
    '<ul>',
    '  <li></li>',
    '</ul>',
    '<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>',
    '<section role="doc-endnotes" aria-label="Footnotes">',
    '  <hr>',
    '  <ol>',
    '    <li id="fn1">',
    '      <ul>',
    '        <li>li',
    '          <pre><code></code></pre>',
    '        </li>',
    '      </ul>',
    '      <ul>',
    '        <li>x</li>',
    '      </ul>',
    '      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>',
    '    </li>',
    '  </ol>',
    '</section>',
  ].join('\n'))
})

it('keeps a paragraph line out of the ended item', () => {
  expect(carveToHtml('[^a]: +\n- li\n+\n  p\n\nsee[^a]\n').trim()).toBe([
    '<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>',
    '<section role="doc-endnotes" aria-label="Footnotes">',
    '  <hr>',
    '  <ol>',
    '    <li id="fn1">',
    '      <ul>',
    '        <li>li</li>',
    '      </ul>',
    '      <p>p<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>',
    '    </li>',
    '  </ol>',
    '</section>',
  ].join('\n'))
})

it('opens a second tight list past a blank run', () => {
  expect(carveToHtml('- [^a]: +\n  - li\n  +\n\n    - x\n\nsee[^a]\n').trim()).toBe([
    '<ul>',
    '  <li></li>',
    '</ul>',
    '<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>',
    '<section role="doc-endnotes" aria-label="Footnotes">',
    '  <hr>',
    '  <ol>',
    '    <li id="fn1">',
    '      <ul>',
    '        <li>li</li>',
    '      </ul>',
    '      <ul>',
    '        <li>x</li>',
    '      </ul>',
    '      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>',
    '    </li>',
    '  </ol>',
    '</section>',
  ].join('\n'))
})

it('opens a second list past a blank after a nested item', () => {
  expect(carveToHtml('[^a]: +\n- li\n  - n\n+\n\n  - x\n\nsee[^a]\n').trim()).toBe([
    '<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>',
    '<section role="doc-endnotes" aria-label="Footnotes">',
    '  <hr>',
    '  <ol>',
    '    <li id="fn1">',
    '      <ul>',
    '        <li>li',
    '          <ul>',
    '            <li>n</li>',
    '          </ul>',
    '        </li>',
    '      </ul>',
    '      <ul>',
    '        <li>x</li>',
    '      </ul>',
    '      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>',
    '    </li>',
    '  </ol>',
    '</section>',
  ].join('\n'))
})

it('ends the list in a quoted note', () => {
  expect(carveToHtml('> [^a]: +\n> - li\n>   - n\n> +\n>   - x\n\nsee[^a]\n').trim()).toBe([
    '<blockquote>',
    '',
    '</blockquote>',
    '<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>',
    '<section role="doc-endnotes" aria-label="Footnotes">',
    '  <hr>',
    '  <ol>',
    '    <li id="fn1">',
    '      <ul>',
    '        <li>li',
    '          <ul>',
    '            <li>n</li>',
    '          </ul>',
    '        </li>',
    '      </ul>',
    '      <ul>',
    '        <li>x</li>',
    '      </ul>',
    '      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>',
    '    </li>',
    '  </ol>',
    '</section>',
  ].join('\n'))
})

it('gives a refused plus after an attached quote to the note', () => {
  expect(carveToHtml('- [^a]: +\n  > q\n  +\n    > q\n\nsee[^a]\n').trim()).toBe([
    '<ul>',
    '  <li></li>',
    '</ul>',
    '<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>',
    '<section role="doc-endnotes" aria-label="Footnotes">',
    '  <hr>',
    '  <ol>',
    '    <li id="fn1">',
    '      <blockquote><p>q</p></blockquote>',
    '      <blockquote><p>q</p></blockquote>',
    '      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>',
    '    </li>',
    '  </ol>',
    '</section>',
  ].join('\n'))
})
