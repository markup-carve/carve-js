import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps a task child at its own content column after a marker-line child', () => {
  expect(carveToHtml('- [ ] - b\n  - [ ] c\n    - [ ] d\n')).toBe(
    '<ul class="task-list">\n  <li><input type="checkbox" disabled> \n    <ul>\n      <li>b</li>\n    </ul>\n    <ul class="task-list">\n      <li><input type="checkbox" disabled aria-label="c"> c\n        <ul class="task-list">\n          <li><input type="checkbox" disabled aria-label="d"> d</li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>',
  )
})

it('keeps the same content-column relationship through another marker-line child', () => {
  const html = carveToHtml('- [ ] - a\n  - [ ] - b\n    - [ ] c\n      - [ ] d\n')
  expect(html).toContain('<li><input type="checkbox" disabled aria-label="c"> c\n            <ul class="task-list">\n              <li><input type="checkbox" disabled aria-label="d"> d</li>')
})
