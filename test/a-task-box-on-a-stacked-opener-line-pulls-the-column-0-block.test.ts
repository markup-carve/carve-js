import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a task box on a stacked opener line before a column-0 plus', () => {
  const shapes: Array<[string, string]> = [
  ["- - [ ] +\n```\nx\n```", "<ul>\n  <li>\n    <ul class=\"task-list\">\n      <li><input type=\"checkbox\" disabled> \n        <pre><code>x\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>"],
  ["- - [ ] +\n| a |\n| b |", "<ul>\n  <li>\n    <ul class=\"task-list\">\n      <li><input type=\"checkbox\" disabled> \n        <table>\n          <tbody>\n            <tr><td>a</td></tr>\n            <tr><td>b</td></tr>\n          </tbody>\n        </table>\n      </li>\n    </ul>\n  </li>\n</ul>"],
  ["- - [ ] +\n> z", "<ul>\n  <li>\n    <ul class=\"task-list\">\n      <li><input type=\"checkbox\" disabled> \n        <blockquote><p>z</p></blockquote>\n      </li>\n    </ul>\n  </li>\n</ul>"],
  ["> - - [ ] +\n> ```\n> x\n> ```", "<blockquote>\n  <ul>\n    <li>\n      <ul class=\"task-list\">\n        <li><input type=\"checkbox\" disabled> \n          <pre><code>x\n</code></pre>\n        </li>\n      </ul>\n    </li>\n  </ul>\n</blockquote>"],
  ["> - - [ ] +\n> | a |\n> | b |", "<blockquote>\n  <ul>\n    <li>\n      <ul class=\"task-list\">\n        <li><input type=\"checkbox\" disabled> \n          <table>\n            <tbody>\n              <tr><td>a</td></tr>\n              <tr><td>b</td></tr>\n            </tbody>\n          </table>\n        </li>\n      </ul>\n    </li>\n  </ul>\n</blockquote>"],
  ["> - - [ ] +\n> > z", "<blockquote>\n  <ul>\n    <li>\n      <ul class=\"task-list\">\n        <li><input type=\"checkbox\" disabled> \n          <blockquote><p>z</p></blockquote>\n        </li>\n      </ul>\n    </li>\n  </ul>\n</blockquote>"],
  ["- - [x] +\n```\nx\n```", "<ul>\n  <li>\n    <ul class=\"task-list\">\n      <li data-task-state=\"x\"><input type=\"checkbox\" checked disabled> \n        <pre><code>x\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>"],
  ["- - [x] +\n| a |\n| b |", "<ul>\n  <li>\n    <ul class=\"task-list\">\n      <li data-task-state=\"x\"><input type=\"checkbox\" checked disabled> \n        <table>\n          <tbody>\n            <tr><td>a</td></tr>\n            <tr><td>b</td></tr>\n          </tbody>\n        </table>\n      </li>\n    </ul>\n  </li>\n</ul>"],
  ["- - [x] +\n> z", "<ul>\n  <li>\n    <ul class=\"task-list\">\n      <li data-task-state=\"x\"><input type=\"checkbox\" checked disabled> \n        <blockquote><p>z</p></blockquote>\n      </li>\n    </ul>\n  </li>\n</ul>"],
  ["> - - [x] +\n> ```\n> x\n> ```", "<blockquote>\n  <ul>\n    <li>\n      <ul class=\"task-list\">\n        <li data-task-state=\"x\"><input type=\"checkbox\" checked disabled> \n          <pre><code>x\n</code></pre>\n        </li>\n      </ul>\n    </li>\n  </ul>\n</blockquote>"],
  ["> - - [x] +\n> | a |\n> | b |", "<blockquote>\n  <ul>\n    <li>\n      <ul class=\"task-list\">\n        <li data-task-state=\"x\"><input type=\"checkbox\" checked disabled> \n          <table>\n            <tbody>\n              <tr><td>a</td></tr>\n              <tr><td>b</td></tr>\n            </tbody>\n          </table>\n        </li>\n      </ul>\n    </li>\n  </ul>\n</blockquote>"],
  ["> - - [x] +\n> > z", "<blockquote>\n  <ul>\n    <li>\n      <ul class=\"task-list\">\n        <li data-task-state=\"x\"><input type=\"checkbox\" checked disabled> \n          <blockquote><p>z</p></blockquote>\n        </li>\n      </ul>\n    </li>\n  </ul>\n</blockquote>"],
  ["- - [X] +\n```\nx\n```", "<ul>\n  <li>\n    <ul class=\"task-list\">\n      <li data-task-state=\"x\"><input type=\"checkbox\" checked disabled> \n        <pre><code>x\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>"],
  ["- - [X] +\n| a |\n| b |", "<ul>\n  <li>\n    <ul class=\"task-list\">\n      <li data-task-state=\"x\"><input type=\"checkbox\" checked disabled> \n        <table>\n          <tbody>\n            <tr><td>a</td></tr>\n            <tr><td>b</td></tr>\n          </tbody>\n        </table>\n      </li>\n    </ul>\n  </li>\n</ul>"],
  ["- - [X] +\n> z", "<ul>\n  <li>\n    <ul class=\"task-list\">\n      <li data-task-state=\"x\"><input type=\"checkbox\" checked disabled> \n        <blockquote><p>z</p></blockquote>\n      </li>\n    </ul>\n  </li>\n</ul>"],
  ["> - - [X] +\n> ```\n> x\n> ```", "<blockquote>\n  <ul>\n    <li>\n      <ul class=\"task-list\">\n        <li data-task-state=\"x\"><input type=\"checkbox\" checked disabled> \n          <pre><code>x\n</code></pre>\n        </li>\n      </ul>\n    </li>\n  </ul>\n</blockquote>"],
  ["> - - [X] +\n> | a |\n> | b |", "<blockquote>\n  <ul>\n    <li>\n      <ul class=\"task-list\">\n        <li data-task-state=\"x\"><input type=\"checkbox\" checked disabled> \n          <table>\n            <tbody>\n              <tr><td>a</td></tr>\n              <tr><td>b</td></tr>\n            </tbody>\n          </table>\n        </li>\n      </ul>\n    </li>\n  </ul>\n</blockquote>"],
  ["> - - [X] +\n> > z", "<blockquote>\n  <ul>\n    <li>\n      <ul class=\"task-list\">\n        <li data-task-state=\"x\"><input type=\"checkbox\" checked disabled> \n          <blockquote><p>z</p></blockquote>\n        </li>\n      </ul>\n    </li>\n  </ul>\n</blockquote>"],
  ]

  it.each(shapes)('%j pulls the block into the nested task item', (source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})
