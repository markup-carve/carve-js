import { expect, it } from 'vitest'
import { migrateMarkdown } from '../src/migration.js'
import { MAX_NESTING_DEPTH, parse } from '../src/parse.js'
import { perfIt } from './helpers/scaling.js'

perfIt('imports 200 nested quote markers within a bounded time', () => {
  const source = `${'>'.repeat(200)} x\n`
  const start = performance.now()
  const result = migrateMarkdown(source)
  expect(performance.now() - start).toBeLessThan(2000)
  expect(result.value).toBe(`${'> '.repeat(200)}x\n`)
})

it('uses the parser nesting ceiling for imported quotes', () => {
  const source = `${'>'.repeat(MAX_NESTING_DEPTH + 1)} x\n`
  let node = parse(migrateMarkdown(source).value).children[0]
  let depth = 0
  while (node?.type === 'block_quote') {
    depth++
    node = node.children[0]
  }
  expect(depth).toBe(MAX_NESTING_DEPTH)
  expect(node?.type).toBe('paragraph')
})
