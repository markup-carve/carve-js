import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { carveToHtml, citations } from '../src/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const corpusDir = resolve(__dirname, '../spec/tests/corpus-optional')
const manifestPath = resolve(corpusDir, 'manifest.json')

if (!existsSync(manifestPath)) {
  throw new Error(
    `Optional Tier-2 corpus manifest not found at ${manifestPath}.\n` +
      `Did you initialize and update the spec submodule?`,
  )
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
  cases: Array<{ slug: string; feature: string }>
}

const featureRunners: Record<string, (source: string) => string> = {
  'social-link-templates': (source) =>
    carveToHtml(source, {
      mentionUrl: '/users/{name}',
      tagUrl: '/topics/{name}',
    }),
  'symbol-map': (source) =>
    carveToHtml(source, {
      symbols: {
        rocket: '🚀',
        tada: '🎉',
        '+1': '👍',
        UPPER: '⬆️',
      },
    }),
  'citations-numbered': (source) => carveToHtml(source, { extensions: [citations()] }),
  'citations-author-date': (source) =>
    carveToHtml(source, { extensions: [citations({ mode: 'author-date' })] }),
}

describe('optional Tier-2 corpus', () => {
  for (const entry of manifest.cases) {
    const slug = basename(entry.slug)
    const crvPath = resolve(corpusDir, `${slug}.crv`)
    const htmlPath = resolve(corpusDir, `${slug}.html`)
    const render = featureRunners[entry.feature]

    if (!render) {
      it.skip(`${slug} (${entry.feature})`, () => {})
      continue
    }

    it(`${slug} (${entry.feature})`, () => {
      expect(existsSync(crvPath)).toBe(true)
      expect(existsSync(htmlPath)).toBe(true)
      const source = readFileSync(crvPath, 'utf8')
      const expected = readFileSync(htmlPath, 'utf8')
      expect(render(source).trim()).toBe(expected.trim())
    })
  }
})
