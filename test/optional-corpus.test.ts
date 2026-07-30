import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  carveToAnsi,
  carveToHtml,
  carveToMarkdown,
  carveToPlainText,
  citations,
} from '../src/index.js'

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
  cases: Array<{ slug: string; feature: string; target?: string }>
}

type Render = (source: string, opts?: Record<string, unknown>) => string

/*
 * A case pins the HTML target unless its manifest entry names another one
 * (carve#360). The extension is the pairing rule, not a label: a case is
 * located from its slug and its target alone.
 *
 * `carve` is absent by design - Carve-source expectations live in the spec's
 * corpus-roundtrip, which has its own runner.
 */
const targets: Record<string, { extension: string; render: Render }> = {
  html: { extension: 'html', render: carveToHtml as Render },
  markdown: { extension: 'md', render: carveToMarkdown as Render },
  plain: { extension: 'txt', render: carveToPlainText as Render },
  ansi: { extension: 'ansi', render: carveToAnsi as Render },
}

/*
 * A feature runner supplies its feature's configuration and renders through
 * whichever target the case named, so one entry serves a feature pinned on more
 * than one target.
 */
const featureRunners: Record<string, (source: string, render: Render) => string> = {
  'social-link-templates': (source, render) =>
    render(source, {
      mentionUrl: '/users/{name}',
      tagUrl: '/topics/{name}',
    }),
  'symbol-map': (source, render) =>
    render(source, {
      symbols: {
        rocket: '🚀',
        tada: '🎉',
        '+1': '👍',
        UPPER: '⬆️',
      },
    }),
  'citations-numbered': (source, render) => render(source, { extensions: [citations()] }),
  'citations-author-date': (source, render) =>
    render(source, { extensions: [citations({ mode: 'author-date' })] }),
}

describe('optional Tier-2 corpus', () => {
  for (const entry of manifest.cases) {
    const slug = basename(entry.slug)
    const targetName = entry.target ?? 'html'
    const target = targets[targetName]

    // An unknown target is a corpus error, not an unsupported feature. Skipping
    // it would read as "carve-js does not do that yet".
    if (!target) {
      it(`${slug} (${entry.feature})`, () => {
        throw new Error(
          `unknown target '${targetName}' - expected one of ${Object.keys(targets).join(', ')}`,
        )
      })
      continue
    }

    const crvPath = resolve(corpusDir, `${slug}.crv`)
    const expectedPath = resolve(corpusDir, `${slug}.${target.extension}`)
    const runner = featureRunners[entry.feature]

    if (!runner) {
      it.skip(`${slug} (${entry.feature})`, () => {})
      continue
    }

    it(`${slug} (${entry.feature}, ${targetName})`, () => {
      expect(existsSync(crvPath)).toBe(true)
      expect(existsSync(expectedPath)).toBe(true)
      const source = readFileSync(crvPath, 'utf8')
      const expected = readFileSync(expectedPath, 'utf8')
      expect(runner(source, target.render).trim()).toBe(expected.trim())
    })
  }
})
