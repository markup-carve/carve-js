import { expect, test } from 'vitest'
import { markdownToCarve, carveToHtml, parse } from '../src/index.js'

test('a blank after an empty item loosens its sibling list', () => {
  const written = markdownToCarve('* a\n*\n\n* c\n')
  expect(carveToHtml(written).trim()).toBe('<ul>\n  <li><p>a</p></li>\n  <li></li>\n  <li><p>c</p></li>\n</ul>')
})

test.each(['- a\n- +\n\n- c', '1. a\n2. +\n\n3. c', '- [x] a\n- [ ] +\n\n- [x] c'])('an empty lead keeps its compatible sibling: %s', source => {
  const doc = parse(source)
  expect(doc.children).toHaveLength(1)
  const list = doc.children[0]!
  expect(list.type).toBe('list')
  if (list.type === 'list') {
    expect(list.items).toHaveLength(3)
    expect(list.tight).toBe(false)
  }
})

test('three blanks after an empty item remain a list boundary', () => {
  expect(parse('- a\n- +\n\n\n\n- c').children).toHaveLength(2)
})

test('a flush paragraph still attaches after an empty lead marker', () => {
  expect(carveToHtml('- +\ntext\n- next').trim()).toBe('<ul>\n  <li>text</li>\n  <li>next</li>\n</ul>')
})
