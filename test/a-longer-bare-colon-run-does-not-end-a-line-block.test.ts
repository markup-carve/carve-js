import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// PART 0 colon fence [B-div-end] and [B-div-keep] (carve#4113): inside a line block in a list item,
// a bare colon run of another width is payload, so the line block stays open for a lazy line.
describe('a longer bare colon run does not end a line block', () => {
  it.each([
    [
      'the ticket\'s shape',
      "- m\n  ::: |\n  ::::\nl\n",
      "<ul>\n  <li>m\n    <div class=\"line-block\">\n      <p>::::<br>\nl</p>\n    </div>\n  </li>\n</ul>",
    ],
    [
      'a lazy line with a space',
      "- m\n  ::: |\n  ::::\n l\n",
      "<ul>\n  <li>m\n    <div class=\"line-block\">\n      <p>::::<br>\nl</p>\n    </div>\n  </li>\n</ul>",
    ],
    [
      'a shorter run in a wider line block',
      "- m\n  :::: |\n  :::\nl\n",
      "<ul>\n  <li>m\n    <div class=\"line-block\">\n      <p>:::<br>\nl</p>\n    </div>\n  </li>\n</ul>",
    ],
    [
      'a much longer run',
      "- m\n  ::: |\n  :::::\nl\n",
      "<ul>\n  <li>m\n    <div class=\"line-block\">\n      <p>:::::<br>\nl</p>\n    </div>\n  </li>\n</ul>",
    ],
    [
      'a nested item',
      "- m\n  - n\n    ::: |\n    ::::\n  l\n",
      "<ul>\n  <li>m\n    <ul>\n      <li>n\n        <div class=\"line-block\">\n          <p>::::<br>\nl</p>\n        </div>\n      </li>\n    </ul>\n  </li>\n</ul>",
    ],
    [
      'a quoted item',
      "> - m\n>   ::: |\n>   ::::\nl\n",
      "<blockquote>\n  <ul>\n    <li>m\n      <div class=\"line-block\">\n        <p>::::<br>\nl</p>\n      </div>\n    </li>\n  </ul>\n</blockquote>",
    ],
    [
      'the line block on the marker line',
      "- ::: |\n  ::::\nl\n",
      "<ul>\n  <li>\n    <div class=\"line-block\">\n      <p>::::<br>\nl</p>\n    </div>\n  </li>\n</ul>",
    ],
    [
      'a description keeps its reading',
      ":: t\n: ::: |\n  ::::\nl\n",
      "<dl>\n  <dt>t</dt>\n  <dd>\n    <div class=\"line-block\">\n      <p>::::</p>\n    </div>\n  </dd>\n</dl>\n<p>l</p>",
    ],
    [
      'the exact-width closer still ends it',
      "- m\n  ::: |\n  :::\nl\n",
      "<ul>\n  <li>m\n    <div class=\"line-block\">\n\n    </div>\n  </li>\n</ul>\n<p>l</p>",
    ],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source).trim()).toBe(html)
  })
})
