/*
 * Spec-corpus test runner.
 *
 * Walks spec/tests/corpus/, pairs every NN-slug.crv with its
 * NN-slug.html, feeds the .crv through parse + renderHtml, and asserts
 * byte-identical match against the .html (after trimming).
 *
 * Pairs in IMPLEMENTED are run as real tests; everything else is marked
 * .todo. As each construct lands, add its slug here and the test goes
 * from todo → passing.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { carveToHtml } from '../src/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const corpusDir = resolve(__dirname, '../spec/tests/corpus')

if (!existsSync(corpusDir)) {
  throw new Error(
    `Spec corpus not found at ${corpusDir}.\n` +
      `Did you initialize the submodule?\n` +
      `  git submodule update --init`,
  )
}

/**
 * Category prefixes the parser + renderer can handle. Every sub-example
 * with a matching prefix runs as a real test (e.g. '01-emphasis' covers
 * '01-emphasis-2', '01-emphasis-3', …). Grows with each PR.
 */
const IMPLEMENTED = new Set([
  '01-emphasis',
  '02-headings',
  '03-links',
  '04-images',
  '05-lists',
  '06-task-lists',
  '07-blockquote-with-attribution',
  '08-image-with-caption',
  '09-tables',
  '10-tables-with-rowspan-and-colspan',
  '11-fenced-code',
  '12-inline-code',
  '13-admonitions',
  '14-abbreviations',
  '15-mentions-and-tags',
  '16-inline-extensions',
  '17-attributes',
  '18-frontmatter',
])

/**
 * Sub-examples in IMPLEMENTED categories that are known to fail because
 * a specific construct is not yet supported. Move out of this set as
 * implementation lands.
 */
const KNOWN_GAPS = new Set<string>([])

const baseSlug = (name: string) => name.replace(/-\d+$/, '')

const pairs = readdirSync(corpusDir)
  .filter((f) => f.endsWith('.crv'))
  .map((f) => basename(f, '.crv'))
  .sort()

describe('spec corpus', () => {
  for (const name of pairs) {
    const crvPath = resolve(corpusDir, `${name}.crv`)
    const htmlPath = resolve(corpusDir, `${name}.html`)

    if (!existsSync(htmlPath)) {
      it.skip(`${name} (missing .html pair)`, () => {})
      continue
    }

    const source = readFileSync(crvPath, 'utf8')
    const expected = readFileSync(htmlPath, 'utf8')
    const allowlisted = IMPLEMENTED.has(name) || IMPLEMENTED.has(baseSlug(name))

    if (allowlisted && !KNOWN_GAPS.has(name)) {
      it(`${name}`, () => {
        const actual = carveToHtml(source)
        expect(actual.trim()).toBe(expected.trim())
      })
    } else {
      it.todo(`${name}`)
    }
  }
})
