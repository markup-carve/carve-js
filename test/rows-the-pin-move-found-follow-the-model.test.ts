/*
 * Corpus rows that regressed between the carve pin 572e7b72 and carve-js main.
 * Each now renders as the spec model does.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { carveToHtml } from '../src/index.js'

const corpusDir = resolve(dirname(fileURLToPath(import.meta.url)), '../spec/tests/corpus')

const ROWS = [
  '823-a-fence-in-a-list-a-quote-attaches-takes-no-separator-line-4',
  '851-an-accepted-plus-needs-a-follower-that-reaches-its-host',
  '851-an-accepted-plus-needs-a-follower-that-reaches-its-host-2',
  '855-a-marker-past-a-term-ends-its-note',
  '855-a-marker-past-a-term-ends-its-note-2',
  '856-a-quote-at-the-content-column-stays-in-the-item-after-a-refused-separator',
  '859-a-line-folded-into-a-child-s-paragraph-is-not-the-item-s-text-3',
  '859-a-line-folded-into-a-child-s-paragraph-is-not-the-item-s-text-4',
  '873-a-plus-after-an-attached-block-reaches-its-host-through-quote-prefixes-2',
]

describe('rows the pin move found follow the model', () => {
  for (const row of ROWS) {
    it(row, () => {
      const source = readFileSync(resolve(corpusDir, `${row}.crv`), 'utf8')
      const html = readFileSync(resolve(corpusDir, `${row}.html`), 'utf8')
      expect(carveToHtml(source).trim()).toBe(html.trim())
    })
  }

  // Shapes around the rows, each checked against the spec model.
  const SHAPES: Array<[string, string]> = [
    ['> t\n+\n:: t\n: ```\n\nx\n', '<blockquote>\n  <p>t</p>\n  <dl>\n    <dt>t</dt>\n    <dd>\n      <pre><code></code></pre>\n    </dd>\n  </dl>\n</blockquote>\n<p>x</p>'],
    ['> > +\n> >\n', '<blockquote>\n  <blockquote><p>+</p></blockquote>\n</blockquote>'],
    ['- a\n+\n# h\n\n+\n# h\n', '<ul>\n  <li>a\n    <h1 id="h">h</h1>\n    <h1 id="h-2">h</h1>\n  </li>\n</ul>'],
    ['- > :: t\n : a\n  > q\n', '<ul>\n  <li>\n    <blockquote>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </blockquote>\n    : a\n    <blockquote><p>q</p></blockquote>\n  </li>\n</ul>'],
  ]
  for (const [source, html] of SHAPES) {
    it(JSON.stringify(source), () => {
      expect(carveToHtml(source).trim()).toBe(html)
    })
  }
})
