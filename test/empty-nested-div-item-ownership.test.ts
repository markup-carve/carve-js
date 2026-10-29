import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const first = '<ul>\n  <li>a\n    <ul>\n      <li>\n        <div class="box">\n\n        </div>\n      </li>\n    </ul>\n  </li>\n</ul>'

it('ends a list after an empty nested marker-line div', () => {
  expect(carveToHtml('- a\n  - ::: box\nlazy')).toBe(first + '\n<p>lazy</p>')
  expect(carveToHtml('- a\n  - ::: box\n - next')).toBe('<ul>\n  <li>a\n    <ul>\n      <li>\n        <div class="box">\n\n        </div>\n      </li>\n    </ul>\n  </li>\n  <li>next</li>\n</ul>')
})

it('keeps an open div paragraph in its item', () => {
  expect(carveToHtml('- a\n  - ::: box\n    body\nlazy')).toContain('<p>body\nlazy</p>')
  expect(carveToHtml('- a\n  - ::: box\n    :::\nlazy')).toBe(first + '\n<p>lazy</p>')
})

it('ends the outer item inside a quote at its content column', () => {
  const html = carveToHtml('> - a\n>   - ::: box\n>  - next\n>     :::\n- tail')
  expect(html).toContain('<li>next\n')
  expect(html).toContain('<li>tail</li>')
})
