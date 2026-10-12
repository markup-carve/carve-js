import { expect, it } from 'vitest'
import { migrateMarkdown } from '../src/index.js'
import { markdownToCarveWithLosses } from '../src/markdown-migrate.js'

const opener = '<!-- carve: ::: note -->'
const closer = '<!-- carve: ::: -->'
const invalidAttribute = '<!-- carve: {key="unterminated} -->'
const garbage = '<!-- carve: garbage -->'

it.each([invalidAttribute, garbage])('drops only the invalid marker %s', marker => {
  const result = migrateMarkdown(`${opener}\n${marker}\nBody.\n${closer}\n`)
  expect(result.value).toBe('::: note\nBody.\n:::\n')
  expect(markdownToCarveWithLosses(`${opener}\n${marker}\nBody.\n${closer}\n`).losses).toEqual([
    expect.objectContaining({ line: 2 }),
  ])
  const losses = result.report.diagnostics.filter(d => d.code === 'carrier-markers-damaged')
  expect(losses).toEqual([expect.objectContaining({
    path: 'line:2',
    message: `Dropped carrier marker with an invalid payload: ${marker}`,
    fidelity: 'degraded',
    confidence: 'fallback',
  })])
})

it('reports each invalid marker at its original source line', () => {
  const result = migrateMarkdown(`${invalidAttribute}\n${opener}\n${garbage}\nBody.\n${closer}\n`)
  expect(result.value).toBe('::: note\nBody.\n:::\n')
  expect(result.report.diagnostics.filter(d => d.code === 'carrier-markers-damaged')).toEqual([
    expect.objectContaining({ path: 'line:1', message: expect.stringContaining(invalidAttribute) }),
    expect.objectContaining({ path: 'line:3', message: expect.stringContaining(garbage) }),
  ])
})

it('keeps the original markers and reports only whole-set damage when pairing breaks', () => {
  const source = `${invalidAttribute}\n${opener}\n${garbage}\nBody.\n`
  const result = migrateMarkdown(source)
  expect(result.value).toContain(invalidAttribute)
  expect(result.value).toContain(opener)
  expect(result.value).toContain(garbage)
  expect(result.value).not.toMatch(/^::: note$/m)
  const losses = result.report.diagnostics.filter(d => d.code === 'carrier-markers-damaged')
  expect(losses).toHaveLength(1)
  expect(losses[0]).toMatchObject({
    message: 'Carrier markers no longer record a structure; read the source as plain Markdown',
    fidelity: 'degraded',
    confidence: 'fallback',
  })
  expect(losses[0]).not.toHaveProperty('path')
  expect(markdownToCarveWithLosses(source).losses.filter(d => d.code === 'carrier-markers-damaged')[0]).not.toHaveProperty('line')
})

it('removes an invalid marker when no valid markers remain', () => {
  const result = migrateMarkdown(`${garbage}\nBody.\n`)
  expect(result.value).toBe('Body.\n')
  expect(result.report.diagnostics.filter(d => d.code === 'carrier-markers-damaged')).toEqual([
    expect.objectContaining({ path: 'line:1' }),
  ])
})

it('keeps later diagnostic lines after an invalid marker', () => {
  const result = migrateMarkdown(`${garbage}\n\n1. [x] task\n`)
  expect(result.report.diagnostics.find(d => d.code === 'structure-unspellable'))
    .toMatchObject({ path: 'line:3' })
  expect(result.value).not.toContain('carve: garbage')
})
