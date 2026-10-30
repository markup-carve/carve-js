import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each([
  ['{=_*_*_{c==}}', '<p><mark><u>*</u>*_{c=</mark>}</p>'],
  ['{*_~_~_{c**}}', '<p><strong><u>~</u>~_{c*</strong>}</p>'],
  ['{=~_~_~{c==}}', '<p><mark><s>_</s>_~{c=</mark>}</p>'],
  ['{=\\=_*_*_{c==}}', '<p><mark>=<u>*</u>*_{c=</mark>}</p>'],
  ['{=`=`_*_*_{c==}}', '<p><mark><code>=</code><u>*</u>*_{c=</mark>}</p>'],
  ['{=[=](/u)_*_*_{c==}}', '<p><mark><a href="/u">=</a><u>*</u>*_{c=</mark>}</p>'],
  ['{=[x](/=)_*_*_{c==}}', '<p><mark><a href="/=">x</a><u>*</u>*_{c=</mark>}</p>'],
])('a last marker the left-to-right pairing leaves open takes no block: %s', (source, html) => {
  expect(carveToHtml(source).trim()).toBe(html)
})

it.each([
  ['{=_*_{c==}}', '<p>{=<u c="=">*</u>}</p>'],
  ['{=_a_ _b_{c==}}', '<p>{=<u>a</u> <u c="=">b</u>}</p>'],
  ['{~_~_~_{c=~~}}', '<p>{<s>_</s><u c="~~">~</u>}</p>'],
])('a closer the pairing reaches keeps its block: %s', (source, html) => {
  expect(carveToHtml(source).trim()).toBe(html)
})
