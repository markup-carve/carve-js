import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const normalize = (html: string) => html.trim().split('\n').map(line => line.trim()).filter(Boolean).join('\n')

it.each([
  ['task with following list', '* [ ] task\n  1. ordered\n    :: term\n    :  detail\n      :: term\n      :  detail\n\tq\n1. ordered\n', `<ul class="task-list">
<li><input type="checkbox" disabled aria-label="task"> task
<ol>
<li>ordered</li>
</ol>
<dl>
<dt>term</dt>
<dd>detail</dd>
<dt>term</dt>
<dd>detail
q</dd>
</dl>
</li>
</ul>
<ol>
<li>ordered</li>
</ol>`],
  ['item with plain followers', '- a\n  1. ordered\n    :: term\n    :  detail\n      :: term\n      :  detail\n   q  \n   text\n', `<ul>
<li>a
<ol>
<li>ordered</li>
</ol>
<dl>
<dt>term</dt>
<dd>detail</dd>
<dt>term</dt>
<dd>detail
q
text</dd>
</dl>
</li>
</ul>`],
  ['task with quoted follower', '* [ ] task\n  1. ordered\n    :: term\n    :  detail\n      :: term\n      :  detail\n        q\n        > quote\n', `<ul class="task-list">
<li><input type="checkbox" disabled aria-label="task"> task
<ol>
<li>ordered</li>
</ol>
<dl>
<dt>term</dt>
<dd>detail</dd>
<dt>term</dt>
<dd>detail
q</dd>
</dl>
<blockquote><p>quote</p></blockquote>
</li>
</ul>`],
])('returns %s below a description to the surviving item', (_name, source, expected) => {
  expect(normalize(carveToHtml(source))).toBe(expected)
})
