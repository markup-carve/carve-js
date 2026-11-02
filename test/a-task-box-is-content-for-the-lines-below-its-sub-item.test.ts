import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

// The task box is content (CARVE-P0-008): a line left of a box-line sub-item's
// marker is below that sub-item's content column (carve-js#3966, #3957).
describe('a task box before a sub-item or below an outer item', () => {
  it('opens a list at a marker line between the box and the sub-item', () => {
    expect(h('* [ ] 1. p\n   - a\n')).toBe(
      '<ul class="task-list">\n  <li><input type="checkbox" disabled> \n    <ol>\n      <li>p</li>\n    </ol>\n    <ul>\n      <li>a</li>\n    </ul>\n  </li>\n</ul>',
    )
    expect(h('- [x] - p\n     1. a\n')).toBe(
      '<ul class="task-list">\n  <li data-task-state="x"><input type="checkbox" checked disabled> \n    <ul>\n      <li>p</li>\n    </ul>\n    <ol>\n      <li>a</li>\n    </ol>\n  </li>\n</ul>',
    )
  })

  it('opens in the task item at its content column or the sub-item marker column', () => {
    expect(h('* [ ] 1. p\n  - a\n')).toBe(
      '<ul class="task-list">\n  <li><input type="checkbox" disabled> \n    <ol>\n      <li>p</li>\n    </ol>\n    <ul>\n      <li>a</li>\n    </ul>\n  </li>\n</ul>',
    )
    expect(h('* [ ] 1. p\n   # a\n')).toBe(
      '<ul class="task-list">\n  <li><input type="checkbox" disabled> \n    <ol>\n      <li>p</li>\n    </ol>\n    <h1 id="a">a</h1>\n  </li>\n</ul>',
    )
    expect(h('* [ ] 1. p\n      - a\n')).toBe(
      '<ul class="task-list">\n  <li><input type="checkbox" disabled> \n    <ol>\n      <li>p</li>\n    </ol>\n    <ul>\n      <li>a</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('lets an outer item see a closed block that a task item holds', () => {
    expect(h('- - [ ] para\n       ```\n       x\n       ```\n tail\n')).toBe(
      '<ul>\n  <li>\n    <ul class="task-list">\n      <li><input type="checkbox" disabled aria-label="para"> para\n        <pre><code>x\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>',
    )
    expect(h('- * [x] p\n    ```\n    x\n    ```\n tail\n')).toBe(
      '<ul>\n  <li>\n    <ul class="task-list">\n      <li data-task-state="x"><input type="checkbox" checked disabled aria-label="p"> p\n        <pre><code>x\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>',
    )
    expect(h('1. - * [x] p\n            ```\n            x\n            ```\n    tail\n')).toBe(
      '<ol>\n  <li>\n    <ul>\n      <li>\n        <ul class="task-list">\n          <li data-task-state="x"><input type="checkbox" checked disabled aria-label="p"> p\n            <pre><code>x\n</code></pre>\n          </li>\n        </ul>\n      </li>\n    </ul>\n    tail\n  </li>\n</ol>',
    )
    expect(h('- - [ ] para\n      q\n tail\n')).toBe(
      '<ul>\n  <li>\n    <ul class="task-list">\n      <li><input type="checkbox" disabled aria-label="para q tail"> para\nq\ntail</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('reads a deep term below a blank after a lazy separator without running away', () => {
    expect(h('* [ ] * :: t\n : d\n\n         :: u\n')).toBe(
      '<ul class="task-list">\n  <li><input type="checkbox" disabled> \n    <ul>\n      <li>\n        <dl>\n          <dt>t\n: d</dt>\n          <dt>u</dt>\n        </dl>\n      </li>\n    </ul>\n  </li>\n</ul>',
    )
  })
})
