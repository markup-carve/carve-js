import { expect, it } from 'vitest'
import { carveToAstJson } from '../src/index.js'

it.each([
  ['- +\n  %%%\n  c\n  %%%\ntext\n', 'c'],
  ['- +\n  %%%\n    c\n  %%%\ntext\n', '  c'],
  ['- +\n  %%%\n  c\n    d\n  %%%\ntext\n', 'c\n  d'],
])('keeps only payload indentation in a skipped fenced comment: %j', (source, content) => {
  const doc = carveToAstJson(source)
  const list = doc.children[0]
  expect(list?.type).toBe('list')
  if (list?.type !== 'list') return
  const comment = list.items[0]?.children[0]
  expect(comment?.type).toBe('comment')
  if (comment?.type === 'comment') expect(comment.content).toBe(content)
})
