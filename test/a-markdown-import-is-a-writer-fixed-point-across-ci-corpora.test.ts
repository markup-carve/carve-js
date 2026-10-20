import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { carveToCarve, markdownToCarve } from '../src/index.js'

const root = resolve(import.meta.dirname, '..')
const commonmark = JSON.parse(readFileSync(resolve(root, 'spec/tests/import-comparison/commonmark.json'), 'utf8')) as Array<{ markdown: string }>
const corpusDir = resolve(root, 'spec/tests/corpus')
const convertDir = resolve(root, 'spec/tests/corpus-convert')
const inputs: Array<[string, string]> = [
  ...commonmark.map((example, index): [string, string] => [`CommonMark ${index + 1}`, example.markdown]),
  ...readdirSync(corpusDir).filter(name => name.endsWith('.md')).sort().map((name): [string, string] =>
    [name, readFileSync(resolve(corpusDir, name), 'utf8')]),
  ...readdirSync(convertDir).filter(name => existsSync(resolve(convertDir, name, 'input.md'))).sort().map((name): [string, string] =>
    [name, readFileSync(resolve(convertDir, name, 'input.md'), 'utf8')]),
]

describe('a Markdown import is a writer fixed point across CI corpora', () => {
  it('contains all CommonMark examples', () => expect(commonmark).toHaveLength(652))

  it.each(inputs)('%s', (_name, markdown) => {
    const imported = markdownToCarve(markdown)
    expect(carveToCarve(imported)).toBe(imported)
  })
})
