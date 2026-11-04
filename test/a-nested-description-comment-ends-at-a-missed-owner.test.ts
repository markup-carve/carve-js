import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// PART 0 S1 and CARVE-P0-013, expected HTML from carve#5069 and the spec model.
describe('a nested description comment ends at a line that misses its owner', () => {
  it('renders the carve#5069 reproduction', () => {
    expect(carveToHtml(':: t\n: - - ```\n    %%%\n     ```\nx\n')).toBe([
      '<dl>',
      '  <dt>t</dt>',
      '  <dd>',
      '    <ul>',
      '      <li>',
      '        <ul>',
      '          <li>',
      '            <pre><code></code></pre>',
      '          </li>',
      '        </ul>',
      '      </li>',
      '    </ul>',
      '  </dd>',
      '</dl>',
      '<p>x</p>',
    ].join('\n'))
  })

  it.each([
    ':: t\n:   - - ````\n      %%%%\n        ~~~\nx\n',
    ':: t\n:   - - ```\n      %%%%\n        ```\nx\n',
    ':: t\n: - - ````\n    %%%%\n     ```\nx\n',
    ':: t\n: - - ```\n    %%%%\n     ````\nx\n',
    ':: t\n: - - ~~~\n    %%%\n       ~~~\nx\n%%%\n',
    ':: t\n: - - ```\n    %%%%\n      # h\nx\n%%%\n',
    ':: t\n: - 1. ```\n     %%%%\n      # h\nx\n%%%\n',
    ':: t\n:   - 1. ~~~\n       %%%%\n         # h\n x\n',
    ':: t\n: - 1. ````\n     %%%%\n     ```\n x\n',
  ])('keeps fence-shaped payload from continuing a paragraph: %j', (source) => {
    const html = carveToHtml(source)
    expect(html).toMatch(/<\/dl>\n<p>x<\/p>$/)
    expect(html.slice(0, html.indexOf('</dl>'))).not.toContain('x')
  })

  it('still folds a lazy line into the paragraph of a line that ended the comment', () => {
    expect(carveToHtml(':: t\n: - - ````\n    %%%%\n  - y\nx\n')).toContain('<li>y\nx</li>')
  })
})
