import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as lib from '../src/index.js'
import {
  autolink,
  carveToAnsi,
  carveToHtml,
  carveToMarkdown,
  carveToPlainText,
  citations,
  codeCallouts,
  details,
  listTable,
  semanticSpan,
  smartQuotes,
  spoiler,
  tabs,
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
 *
 * The configurations are the ones the spec's own runner uses
 * (`spec/tests/optional-corpus.test.mjs`), deliberately spelled the same way,
 * because a feature id means one thing and two files disagreeing about what it
 * configures is a divergence nothing would report.
 */
const featureRunners: Record<string, (source: string, render: Render) => string> = {
  'list-table': (source, render) => render(source, { extensions: [listTable()] }),
  'list-table-columns-1344': (source, render) => render(source, { extensions: [listTable()] }),
  'list-table-local-headers-1248': (source, render) => render(source, { extensions: [listTable()] }),
  'smart-quotes-locale-de': (source, render) =>
    render(source, { extensions: [smartQuotes({ locale: 'de' })] }),
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
  'bare-url-autolink': (source, render) => render(source, { extensions: [autolink()] }),
  'code-callouts': (source, render) => render(source, { extensions: [codeCallouts()] }),
  details: (source, render) => render(source, { extensions: [details()] }),
  'semantic-span': (source, render) => render(source, { extensions: [semanticSpan()] }),
  spoiler: (source, render) => render(source, { extensions: [spoiler()] }),
  tabs: (source, render) => render(source, { extensions: [tabs()] }),
  /*
   * AHEAD OF THE PIN, deliberately. `47-tabs-aria-panel-binding` arrives with
   * the next bump and its manifest feature is `tabs-aria`, so without a runner
   * that bump would fail with "no runner ... and no entry in
   * DECLARED_UNIMPLEMENTED" - a corpus case reading as unimplemented when the
   * engine implements it (carve-js#1265). A runner with no case yet compares
   * nothing and asserts nothing, which is the harmless direction.
   */
  'tabs-aria': (source, render) => render(source, { extensions: [tabs({ mode: 'aria' })] }),
  /*
   * Features that are a RENDER OPTION rather than an extension: no instance to
   * pass, just the switch. They live in the same table so that an engine
   * without the option shows up as a case nobody compared, rather than
   * silently passing on differently-configured output.
   */
  'smart-typography-off': (source, render) => render(source, { smartTypography: false }),
  'markdown-typography-source': (source, render) => render(source, { smartTypography: 'source' }),
  'plain-typography-source': (source, render) => render(source, { smartTypography: 'source' }),
  'ansi-typography-source': (source, render) => render(source, { smartTypography: 'source' }),
  /*
   * DEFAULT typography, with no switch at all. It is the control for the
   * source-mode cases: without one, a case pinning the source spelling also
   * passes an engine that never applies typography to that construct in either
   * mode (carve#915).
   */
  'smart-typography-default': (source, render) => render(source),
  'section-wrapper-off': (source, render) => render(source, { sections: false }),
  'source-line-after-generated-id': (source, render) =>
    render(source, { sections: false, sourceLine: true }),
}

/*
 * Features this engine genuinely does not implement, each with the reason.
 *
 * A skip listed here is a statement about the ENGINE. A skip not listed here
 * would be a statement about THIS FILE, and fails instead - which is the whole
 * of #1255: the missing-runner branch used to be an unconditional `it.skip`, so
 * thirteen features and nineteen of the forty-five cases never ran and the file
 * still reported a clean pass. Eighteen of those nineteen matched their
 * committed fixture the first time a runner was written for them, so eighteen
 * expected files were being verified by nothing.
 *
 * Empty is the correct state. An entry here silences a comparison whether or
 * not the engine would have passed it, so one goes in only with the reason it
 * cannot be a runner instead.
 */
const DECLARED_UNIMPLEMENTED: Record<string, string> = {}

/*
 * Cases this engine has DELIBERATELY moved PAST the pinned corpus on - the same
 * window `test/corpus.test.ts` keeps for the core corpus, and the mirror of the
 * spec repo's `resources/engine-pin-drift.txt`. A rule that lands here between
 * two pin bumps leaves the fixture behind by design.
 *
 * Each entry FAILS IN BOTH DIRECTIONS:
 *
 *  - the output must equal what this engine now states, so a regression is
 *    caught exactly as the corpus would have caught it;
 *  - and it must still DIFFER from the pinned fixture, so an entry the pin has
 *    caught up on fails and is deleted in the commit that moves the pin.
 */
const AHEAD_OF_PIN = new Map<string, { reason: string; expected: string }>([
  [
    '28-tabs-panel-title',
    {
      reason:
        'a tab set says what it is (#1254, markup-carve/carve#1468) and a css panel carries its tab name (#1265, markup-carve/carve#1489); the engine goes first and the pinned corpus still writes the bare wrapper and the anonymous panel',
      expected: [
        '<div class="tabs" role="group" aria-label="Tabs">',
        '<input type="radio" name="tabset-1" id="tabset-1-tab-1" class="tabs-radio" checked>',
        '<label for="tabset-1-tab-1" class="tabs-label">First</label>',
        '<div class="tabs-panel" role="group" aria-label="First">',
        '<p class="admonition-title">Inner <strong>Title</strong></p>',
        '<p>Content one.</p>',
        '</div>',
        '</div>',
      ].join('\n'),
    },
  ],
])

/*
 * THE RATCHET ON THE EXCUSE, because a DECLARED_UNIMPLEMENTED entry can only
 * ever turn a comparison into a skip. The condition such an entry carries is
 * usually checkable, so it is checked: a feature whose name this build EXPORTS
 * is implemented, whatever the map says. A feature that is a render option
 * rather than an extension exports nothing and passes here - correct, because
 * an option's absence is not something an export can report.
 */
describe('DECLARED_UNIMPLEMENTED', () => {
  it('names no feature this build already exports', () => {
    const asExport = (feature: string) => feature.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
    const exported = new Set(Object.keys(lib))
    const stale = Object.keys(DECLARED_UNIMPLEMENTED)
      .filter((feature) => exported.has(asExport(feature)))
      .sort()
    expect(
      stale,
      'this build exports the feature now - give it a runner in featureRunners and delete its DECLARED_UNIMPLEMENTED entry',
    ).toEqual([])
  })

  it('names only features the manifest states', () => {
    const stated = new Set(manifest.cases.map((entry) => entry.feature))
    const orphaned = Object.keys(DECLARED_UNIMPLEMENTED)
      .filter((feature) => !stated.has(feature))
      .sort()
    expect(orphaned, 'renamed upstream, or already retired - either way the entry excuses nothing').toEqual([])
  })
})

/*
 * An AHEAD_OF_PIN entry whose slug is not in the manifest asserts nothing, in
 * either direction, and reads as a live declaration. Same guard the core corpus
 * runner grew for the same reason.
 */
describe('optional AHEAD_OF_PIN', () => {
  it('names only corpus cases that exist', () => {
    const stated = new Set(manifest.cases.map((entry) => basename(entry.slug)))
    const orphaned = [...AHEAD_OF_PIN.keys()].filter((slug) => !stated.has(slug))
    expect(orphaned, 'renamed upstream, or already retired - either way the entry asserts nothing').toEqual([])
  })
})

/*
 * What the loop below actually REACHED, against what it COMPARED.
 *
 * A runner that generates its cases from a manifest reports a clean run when
 * the manifest is empty, because zero tests pass. `compared` is deliberately
 * not `manifest.cases.length`: a case that hit a `continue` above the assertion
 * is a case nobody compared, and these two numbers are how you tell them apart.
 */
let reached = 0
let compared = 0
let declaredSkips = 0
let aheadOfPin = 0

describe('optional Tier-2 corpus', () => {
  for (const entry of manifest.cases) {
    reached++
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
      const reason = DECLARED_UNIMPLEMENTED[entry.feature]
      if (!reason) {
        it(`${slug} (${entry.feature})`, () => {
          throw new Error(
            `no runner for '${entry.feature}' and no entry in DECLARED_UNIMPLEMENTED. ` +
              `Either write the runner, or say why this engine cannot do it - ` +
              `an undeclared skip reads as coverage.`,
          )
        })
        continue
      }
      declaredSkips++
      it.skip(`${slug} (${entry.feature}) - ${reason}`, () => {})
      continue
    }

    const ahead = AHEAD_OF_PIN.get(slug)
    if (ahead) {
      aheadOfPin++
      it(`${slug} (${entry.feature}, ${targetName}) - ahead of the pinned corpus`, () => {
        expect(existsSync(crvPath)).toBe(true)
        expect(existsSync(expectedPath)).toBe(true)
        const source = readFileSync(crvPath, 'utf8')
        const expected = readFileSync(expectedPath, 'utf8')
        expect(runner(source, target.render).trim(), ahead.reason).toBe(ahead.expected)
        // The staleness half: when the pin moves past this rule the fixture is
        // rewritten to exactly this value, and the entry must be deleted.
        expect(
          expected.trim(),
          `${slug} now matches: delete its AHEAD_OF_PIN entry`,
        ).not.toBe(ahead.expected)
      })
      continue
    }

    compared++
    it(`${slug} (${entry.feature}, ${targetName})`, () => {
      expect(existsSync(crvPath)).toBe(true)
      expect(existsSync(expectedPath)).toBe(true)
      const source = readFileSync(crvPath, 'utf8')
      const expected = readFileSync(expectedPath, 'utf8')
      expect(runner(source, target.render).trim()).toBe(expected.trim())
    })
  }
})

describe('the run compared the cases the manifest declares', () => {
  /*
   * The floor is what a manifest emptied or halved cannot get past. It sits
   * well under the count today (44 of 45 cases compare; one is ahead of the
   * pin) for the same reason the other floors in this repo do: the optional
   * corpus is append-only, so a number below it can only be reached by loss.
   */
  it('registers at least the floor of cases', () => {
    expect(
      compared,
      'spec/tests/corpus-optional/manifest.json is the population; a run over ' +
        'fewer of it registers fewer tests and still exits 0',
    ).toBeGreaterThanOrEqual(35)
  })

  /*
   * And a floor cannot see a case the loop REACHED and dropped, which is the
   * hole #1255 came through. Every entry either compares, or is one of the
   * declarations above - stated as an identity, not a floor, so the two sides
   * cannot drift.
   */
  it('reconciles every case it reached', () => {
    expect(
      compared + declaredSkips + aheadOfPin,
      `${reached} case(s) reached, but ${compared} compared + ${declaredSkips} declared ` +
        `unimplemented + ${aheadOfPin} ahead of the pin - the difference is cases nobody checked`,
    ).toBe(reached)
  })
})
