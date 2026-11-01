import { expect, it } from 'vitest'
import { migrateMarkdown, parse } from '../src/index.js'
import { markdownToCarveWithLosses } from '../src/markdown-migrate.js'

const opener = '<!-- carve: ::: note -->'
const closer = '<!-- carve: ::: -->'
const invalidAttribute = '<!-- carve: {key="unterminated} -->'
const garbage = '<!-- carve: garbage -->'

it.each([invalidAttribute, garbage])('drops only the invalid marker %s', marker => {
  const result = migrateMarkdown(`${opener}\n${marker}\nBody.\n${closer}\n`)
  expect(result.value).toBe('::: note\n' + markdownToCarveWithLosses(`${marker}\nBody.\n`).value + ':::\n')
  expect(markdownToCarveWithLosses(`${opener}\n${marker}\nBody.\n${closer}\n`).losses).toEqual([
    expect.objectContaining({ line: 2 }),
  ])
  const losses = result.report.diagnostics.filter(d => d.code === 'carrier-marker-dropped')
  expect(losses).toEqual([expect.objectContaining({
    path: 'line:2',
    message: `Dropped carrier marker with an invalid payload: ${marker}`,
    fidelity: 'degraded',
    confidence: 'fallback',
  })])
})

it('reports each invalid marker at its original source line', () => {
  const result = migrateMarkdown(`${invalidAttribute}\n${opener}\n${garbage}\nBody.\n${closer}\n`)
  expect(result.value).toContain(invalidAttribute)
  expect(result.value).toContain(garbage)
  expect(result.value).toMatch(/^::: note$/m)
  expect(result.report.diagnostics.filter(d => d.code === 'carrier-marker-dropped')).toEqual([
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

it('preserves an invalid marker when no valid markers remain', () => {
  const result = migrateMarkdown(`${garbage}\nBody.\n`)
  expect(result.value).toBe(['```=html', garbage, '```', '', 'Body.', ''].join('\n'))
  expect(result.report.diagnostics.filter(d => d.code === 'carrier-marker-dropped')).toEqual([
    expect.objectContaining({ path: 'line:1' }),
  ])
})

it('keeps later diagnostic lines after an invalid marker', () => {
  const result = migrateMarkdown(`${garbage}\n\n1. [x] task\n`)
  expect(result.report.diagnostics.find(d => d.code === 'structure-unspellable'))
    .toMatchObject({ path: 'line:3' })
  expect(result.value).toContain('carve: garbage')
})

const invalidOpener = '<!-- carve: ::: {key="x -->'

it('drops an invalid opener together with its shape-paired closer', () => {
  const source = `${invalidOpener}\nBody.\n${closer}\n`
  const result = migrateMarkdown(source)
  expect(result.value).toBe(['```=html', invalidOpener, '```', '', 'Body.', '', '```=html', closer, '```', ''].join('\n'))
  expect(result.report.diagnostics.filter(d => d.code.startsWith('carrier-marker'))).toEqual([expect.objectContaining({
    code: 'carrier-marker-dropped',
    path: 'line:1',
    message: `Dropped carrier marker pair with an invalid opener: ${invalidOpener}`,
    fidelity: 'degraded',
    confidence: 'fallback',
  })])
})

it('restores the valid outer pair around an invalid inner pair', () => {
  const innerOpener = invalidOpener.replace(':::', '::::')
  const innerCloser = closer.replace(':::', '::::')
  const body = `${innerOpener}\nBody.\n${innerCloser}\n`
  const result = migrateMarkdown(`${opener}\n${body}${closer}\n`)
  expect(result.value).toBe(['::: note', '```=html', innerOpener, '```', '', 'Body.', '', '```=html', innerCloser, '```', ':::', ''].join('\n'))
  expect(result.report.diagnostics.filter(d => d.code.startsWith('carrier-marker'))).toEqual([expect.objectContaining({
    code: 'carrier-marker-dropped',
    path: 'line:2',
    message: `Dropped carrier marker pair with an invalid opener: ${innerOpener}`,
  })])
})

it('falls back for the whole set when an invalid opener has no closer', () => {
  const result = migrateMarkdown(`${invalidOpener}\nBody.\n`)
  expect(result.value).toContain(invalidOpener)
  expect(result.report.diagnostics.filter(d => d.code.startsWith('carrier-marker'))).toEqual([expect.objectContaining({
    code: 'carrier-markers-damaged',
    fidelity: 'degraded',
    confidence: 'fallback',
  })])
  expect(result.report.diagnostics.find(d => d.code === 'carrier-markers-damaged')).not.toHaveProperty('path')
})

it('drops a depth-bearing container pair and restores the following pair', () => {
  const source = '<!-- carve:2 ::: note -->\nBody.\n<!-- carve: ::: -->\n\n<!-- carve: ::: tip -->\nok\n<!-- carve: ::: -->\n'
  const result = migrateMarkdown(source)
  expect(result.value).toContain('::: tip\nok\n:::')
  expect(result.value).not.toContain('::: note\nBody.')
  expect(result.report.diagnostics.filter(d => d.code.startsWith('carrier-marker'))).toEqual([
    expect.objectContaining({ code: 'carrier-marker-dropped', path: 'line:1' }),
  ])
})

it('drops a depth-bearing attribute marker alone', () => {
  const result = migrateMarkdown('<!-- carve:2 {.x} -->\n# Heading\n')
  expect(parse(result.value).children.find(node => node.type === 'heading')?.attrs?.classes).toBeUndefined()
  expect(result.report.diagnostics.filter(d => d.code.startsWith('carrier-marker'))).toEqual([
    expect.objectContaining({ code: 'carrier-marker-dropped', path: 'line:1' }),
  ])
})
