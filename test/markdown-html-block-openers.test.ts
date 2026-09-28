import { expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

it.each([
  ['<script>\nx\n</style>\nafter', '<script>\nx\n</style>\n<p>after</p>'],
  ['<pre>\nx\n</pre >\nafter', '<pre>\nx\n</pre >\nafter'],
  ['a\n</pre>\nb', '<p>a\n</pre>\nb</p>'],
  ['a\n<div\nb', '<p>a</p>\n<div\nb'],
  ['<pre-x\na', '<p>&lt;pre-x\na</p>'],
  ['<divx\na', '<p>&lt;divx\na</p>'],
  [
    "<table><tr><td>\n<pre>\n**Hello**,\n\n_world_.\n</pre>\n</td></tr></table>\n",
    "<table><tr><td>\n<pre>\n**Hello**,\n<p><em>world</em>.\n</pre></p>\n</td></tr></table>"
  ],
  [
    "<div id=\"foo\"\n  class=\"bar\">\n</div>\n",
    "<div id=\"foo\"\n  class=\"bar\">\n</div>"
  ],
  [
    "<div id=\"foo\" class=\"bar\n  baz\">\n</div>\n",
    "<div id=\"foo\" class=\"bar\n  baz\">\n</div>"
  ],
  [
    "<div id=\"foo\"\n*hi*\n",
    "<div id=\"foo\"\n*hi*"
  ],
  [
    "<div class\nfoo\n",
    "<div class\nfoo"
  ],
  [
    "<div *???-&&&-<---\n*foo*\n",
    "<div *???-&&&-<---\n*foo*"
  ],
  [
    "<style\n  type=\"text/css\">\nh1 {color:red;}\n\np {color:blue;}\n</style>\nokay\n",
    "<style\n  type=\"text/css\">\nh1 {color:red;}\n\np {color:blue;}\n</style>\n<p>okay</p>"
  ],
  [
    "<style\n  type=\"text/css\">\n\nfoo\n",
    "<style\n  type=\"text/css\">\n\nfoo"
  ]
])('reads HTML block openers before a complete tag: %s', (source, expected) => {
  expect(carveToHtml(markdownToCarve(source))).toBe(expected)
})
