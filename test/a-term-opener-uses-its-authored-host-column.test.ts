import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const normalized = (source: string): string =>
  carveToHtml(source).trim().split('\n').map(line => line.trim()).filter(Boolean).join('\n')

it('returns a later quote to the surviving term host', () => {
  expect(normalized('* [ ] task\n  1. ordered\n    :: term\n    :  detail\n       :: term\n      :  detail\n        q\n        > quote\n')).toBe(
    '<ul class="task-list">\n<li><input type="checkbox" disabled aria-label="task"> task\n<ol>\n<li>ordered</li>\n</ol>\n<dl>\n<dt>term</dt>\n<dd>\n<p>detail</p>\n<dl>\n<dt>term</dt>\n</dl>\n<p>:  detail\nq</p>\n<blockquote><p>quote</p></blockquote>\n</dd>\n</dl>\n</li>\n</ul>',
  )
})

it('ends an inner item at its marker column while a term is open', () => {
  expect(normalized('- - a\n    :: m\n  : l\n  : l\n')).toBe(
    '<ul>\n<li>\n<ul>\n<li>a\n<dl>\n<dt>m</dt>\n</dl>\n</li>\n</ul>\n: l\n: l\n</li>\n</ul>',
  )
})

it('lets a later term interrupt after an attached separator', () => {
  expect(normalized('- a\n   :: term\n  :  detail\n    :: term\n    :  detail\n      [^n]: note\n       q\n1. ordered\n')).toBe(
    "<ul>\n<li>a\n<dl>\n<dt>term</dt>\n<dd>detail</dd>\n<dt>term</dt>\n<dd>detail</dd>\n</dl>\n</li>\n</ul>\n<ol>\n<li>ordered</li>\n</ol>",
  )
})
