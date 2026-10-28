import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each([
  '- * :: t\n  : a\n :: sibling\n tail\n',
  '- 1. :: t\n  : a\n :: sibling\n tail\n',
  '10. * :: t\n    : a\n   :: sibling\n   tail\n',
])('keeps a below-column term with the paragraph selected by a shifted separator: %j', (source) => {
  const html = carveToHtml(source)
  expect(html.match(/<dl>/g)).toHaveLength(1)
  expect(html).toContain(': a\n:: sibling\ntail')
})

it.each([
  '- * :: t\n  : a\n   - sibling\n   tail\n',
  '- 1. :: t\n  : a\n    1. sibling\n    tail\n',
])('opens a list marker at the surviving item after a shifted separator: %j', (source) => {
  const html = carveToHtml(source)
  expect(html).toContain('<li>sibling\ntail</li>')
  expect(html).toContain(': a\n')
})

it('leaves the term open when another nested item still owns the separator', () => {
  const html = carveToHtml('- * a. :: t\n  : a\n   - sibling\n   tail\n')
  expect(html).toContain('<dt>t\n: a\n- sibling\ntail</dt>')
  expect(html.match(/<ul>/g)).toHaveLength(2)
})

it('carries a lazy term marker through a deeper item', () => {
  const html = carveToHtml('- * a. :: t\n  : a\n :: sibling\n tail\n')
  expect(html).toContain('<dt>t\n: a\n:: sibling\ntail</dt>')
  expect(html.match(/<dl>/g)).toHaveLength(1)
})

it('opens a later term at the surviving nested item column', () => {
  const html = carveToHtml('- * a. :: t\n  : a\n    :: sibling\n    tail\n')
  expect(html).toContain('<dt>t\n: a</dt>')
  expect(html).toContain('<dt>sibling\ntail</dt>')
  expect(html.match(/<dl>/g)).toHaveLength(2)
})
