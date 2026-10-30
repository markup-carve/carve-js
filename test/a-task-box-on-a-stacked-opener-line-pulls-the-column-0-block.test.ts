import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a task box on a stacked opener line before a refused plus', () => {
  const shapes: Array<[string, string]> = [
  ["- - [ ] +\n```\nx\n```", "<ul>\n  <li>\n    <ul class=\"task-list\">\n      <li><input type=\"checkbox\" disabled aria-label=\"+\"> +</li>\n    </ul>\n  </li>\n</ul>\n<pre><code>x\n</code></pre>"],
  ["- - [ ] +\n| a |\n| b |", "<ul>\n  <li>\n    <ul class=\"task-list\">\n      <li><input type=\"checkbox\" disabled aria-label=\"+\"> +</li>\n    </ul>\n  </li>\n</ul>\n<table>\n  <tbody>\n    <tr><td>a</td></tr>\n    <tr><td>b</td></tr>\n  </tbody>\n</table>"],
  ["- - [ ] +\n> z", "<ul>\n  <li>\n    <ul class=\"task-list\">\n      <li><input type=\"checkbox\" disabled aria-label=\"+\"> +</li>\n    </ul>\n  </li>\n</ul>\n<blockquote><p>z</p></blockquote>"],
  ["> - - [ ] +\n> ```\n> x\n> ```", "<blockquote>\n  <ul>\n    <li>\n      <ul class=\"task-list\">\n        <li><input type=\"checkbox\" disabled aria-label=\"+\"> +</li>\n      </ul>\n    </li>\n  </ul>\n  <pre><code>x\n</code></pre>\n</blockquote>"],
  ["> - - [ ] +\n> | a |\n> | b |", "<blockquote>\n  <ul>\n    <li>\n      <ul class=\"task-list\">\n        <li><input type=\"checkbox\" disabled aria-label=\"+\"> +</li>\n      </ul>\n    </li>\n  </ul>\n  <table>\n    <tbody>\n      <tr><td>a</td></tr>\n      <tr><td>b</td></tr>\n    </tbody>\n  </table>\n</blockquote>"],
  ["> - - [ ] +\n> > z", "<blockquote>\n  <ul>\n    <li>\n      <ul class=\"task-list\">\n        <li><input type=\"checkbox\" disabled aria-label=\"+\"> +</li>\n      </ul>\n    </li>\n  </ul>\n  <blockquote><p>z</p></blockquote>\n</blockquote>"],
  ["- - [x] +\n```\nx\n```", "<ul>\n  <li>\n    <ul class=\"task-list\">\n      <li data-task-state=\"x\"><input type=\"checkbox\" checked disabled aria-label=\"+\"> +</li>\n    </ul>\n  </li>\n</ul>\n<pre><code>x\n</code></pre>"],
  ["- - [x] +\n| a |\n| b |", "<ul>\n  <li>\n    <ul class=\"task-list\">\n      <li data-task-state=\"x\"><input type=\"checkbox\" checked disabled aria-label=\"+\"> +</li>\n    </ul>\n  </li>\n</ul>\n<table>\n  <tbody>\n    <tr><td>a</td></tr>\n    <tr><td>b</td></tr>\n  </tbody>\n</table>"],
  ["- - [x] +\n> z", "<ul>\n  <li>\n    <ul class=\"task-list\">\n      <li data-task-state=\"x\"><input type=\"checkbox\" checked disabled aria-label=\"+\"> +</li>\n    </ul>\n  </li>\n</ul>\n<blockquote><p>z</p></blockquote>"],
  ["> - - [x] +\n> ```\n> x\n> ```", "<blockquote>\n  <ul>\n    <li>\n      <ul class=\"task-list\">\n        <li data-task-state=\"x\"><input type=\"checkbox\" checked disabled aria-label=\"+\"> +</li>\n      </ul>\n    </li>\n  </ul>\n  <pre><code>x\n</code></pre>\n</blockquote>"],
  ["> - - [x] +\n> | a |\n> | b |", "<blockquote>\n  <ul>\n    <li>\n      <ul class=\"task-list\">\n        <li data-task-state=\"x\"><input type=\"checkbox\" checked disabled aria-label=\"+\"> +</li>\n      </ul>\n    </li>\n  </ul>\n  <table>\n    <tbody>\n      <tr><td>a</td></tr>\n      <tr><td>b</td></tr>\n    </tbody>\n  </table>\n</blockquote>"],
  ["> - - [x] +\n> > z", "<blockquote>\n  <ul>\n    <li>\n      <ul class=\"task-list\">\n        <li data-task-state=\"x\"><input type=\"checkbox\" checked disabled aria-label=\"+\"> +</li>\n      </ul>\n    </li>\n  </ul>\n  <blockquote><p>z</p></blockquote>\n</blockquote>"],
  ["- - [X] +\n```\nx\n```", "<ul>\n  <li>\n    <ul class=\"task-list\">\n      <li data-task-state=\"x\"><input type=\"checkbox\" checked disabled aria-label=\"+\"> +</li>\n    </ul>\n  </li>\n</ul>\n<pre><code>x\n</code></pre>"],
  ["- - [X] +\n| a |\n| b |", "<ul>\n  <li>\n    <ul class=\"task-list\">\n      <li data-task-state=\"x\"><input type=\"checkbox\" checked disabled aria-label=\"+\"> +</li>\n    </ul>\n  </li>\n</ul>\n<table>\n  <tbody>\n    <tr><td>a</td></tr>\n    <tr><td>b</td></tr>\n  </tbody>\n</table>"],
  ["- - [X] +\n> z", "<ul>\n  <li>\n    <ul class=\"task-list\">\n      <li data-task-state=\"x\"><input type=\"checkbox\" checked disabled aria-label=\"+\"> +</li>\n    </ul>\n  </li>\n</ul>\n<blockquote><p>z</p></blockquote>"],
  ["> - - [X] +\n> ```\n> x\n> ```", "<blockquote>\n  <ul>\n    <li>\n      <ul class=\"task-list\">\n        <li data-task-state=\"x\"><input type=\"checkbox\" checked disabled aria-label=\"+\"> +</li>\n      </ul>\n    </li>\n  </ul>\n  <pre><code>x\n</code></pre>\n</blockquote>"],
  ["> - - [X] +\n> | a |\n> | b |", "<blockquote>\n  <ul>\n    <li>\n      <ul class=\"task-list\">\n        <li data-task-state=\"x\"><input type=\"checkbox\" checked disabled aria-label=\"+\"> +</li>\n      </ul>\n    </li>\n  </ul>\n  <table>\n    <tbody>\n      <tr><td>a</td></tr>\n      <tr><td>b</td></tr>\n    </tbody>\n  </table>\n</blockquote>"],
  ["> - - [X] +\n> > z", "<blockquote>\n  <ul>\n    <li>\n      <ul class=\"task-list\">\n        <li data-task-state=\"x\"><input type=\"checkbox\" checked disabled aria-label=\"+\"> +</li>\n      </ul>\n    </li>\n  </ul>\n  <blockquote><p>z</p></blockquote>\n</blockquote>"],
  ]

  it.each(shapes)('%j keeps the plus in the nested task item and leaves the block out', (source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})
