import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const corpus = new URL('../spec/tests/corpus/', import.meta.url)
const cases = readdirSync(corpus).filter(file =>
  file.startsWith('782-a-first-block-plus-hands-its-block-to-the-host-as-the-host-reads-it') &&
  file.endsWith('.crv'))

describe('first-block plus gives its block to the host', () => {
  it('loads every pinned row in the category', () => {
    expect(cases).toHaveLength(16)
  })

  it.each(cases)('%s', file => {
    const source = readFileSync(new URL(file, corpus), 'utf8')
    const expected = readFileSync(new URL(file.slice(0, -4) + '.html', corpus), 'utf8')
    expect(carveToHtml(source).trimEnd()).toBe(expected.trimEnd())
  })
})
