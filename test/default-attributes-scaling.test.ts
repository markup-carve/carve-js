import { expect, it } from 'vitest'
import { defaultAttributes } from '../src/default-attributes.js'
import { parse } from '../src/parse.js'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.js'

it('default attributes preserve authored classes and detached key-value objects', () => {
  const doc = parse('word')
  const attrs = { classes: ['a', 'a'], keyValues: { existing: 'kept' }, order: ['existing', '.class'] }
  doc.children[0]!.attrs = attrs
  const originalValues = attrs.keyValues
  defaultAttributes({ defaults: { paragraph: { class: 'a b b', existing: 'ignored', added: 'new' } } }).beforeRender!(doc, { targetIsHtml: true, options: {}, mode: 'interactive', isStatic: false })
  expect(attrs.classes).toEqual(['a', 'a', 'b'])
  expect(attrs.order).toEqual(['existing', '.class', 'added'])
  expect(originalValues).toEqual({ existing: 'kept' })
  expect(attrs.keyValues).toEqual({ existing: 'kept', added: 'new' })
})

for (const kind of ['classes', 'keys']) {
  perfIt(`large default attribute ${kind} scale`, () => {
    expectBuiltInputScansLinearly(source => {
      const defaults = kind === 'classes' ? { class: source } : Object.fromEntries(source.split(' ').map(key => [key, 'value']))
      defaultAttributes({ defaults: { paragraph: defaults } }).beforeRender!(parse('word'), { targetIsHtml: true, options: {}, mode: 'interactive', isStatic: false })
    }, n => Array.from({ length: n }, (_, i) => `c${i}`).join(' '),
    { smallRepeats: 4_000, label: `default ${kind}` })
  })
}
