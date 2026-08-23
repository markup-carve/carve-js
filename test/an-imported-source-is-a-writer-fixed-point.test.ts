import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { htmlToCarve, carveToCarve, HtmlImportLimitError } from '../src/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const corpusDir = resolve(__dirname, '../spec/tests/corpus')

if (!existsSync(corpusDir)) {
  throw new Error(
    `Spec corpus not found at ${corpusDir}.\n` +
      `Did you initialize the submodule?\n` +
      `  git submodule update --init`,
  )
}

const cases = readdirSync(corpusDir)
  .filter((f) => f.endsWith('.html'))
  .map((f) => basename(f, '.html'))
  .sort()

/**
 * The one document whose import is NOT a fixed point, with the reason.
 *
 * `docs/html-import.md` states the rule without a condition - "an importer
 * emits the source `carve fmt` emits, down to whether an attribute value
 * carries quotes and which slot it sits in" - and the spec repo checks it over
 * the 20 shared fixtures. Over the 1370-document render corpus it was red on
 * 54; the whitespace fix beside this file answers 53 of them.
 *
 * The survivor is not a whitespace question and not a defect of this engine
 * alone. Its `<code>` payload holds a BLANK LINE:
 *
 *     <div class="line-block">
 *       <p>a <code>b
 *
 *     c</code></p>
 *     </div>
 *
 * A code span is bounded by its line, so no Carve source spells a code value
 * with a blank line in it, and the writer has no form to fall back to - it
 * emits the value between two backticks and the re-parse ends the paragraph at
 * the blank line instead. carve-php `aae2f24` produces the same non-fixed-point
 * from the same input (it writes the `:::` sugar rather than the class, and
 * then breaks identically), so this is a question about what a writer owes an
 * unspellable verbatim value, not a divergence to be closed here. `renderCarve`
 * already refuses some such values with `SourceUnspellableError`; whether this
 * one joins them, or the importer degrades it, wants a ruling rather than a
 * guess.
 *
 * SHRINK-ONLY, and the staleness test below is what makes it safe: an entry
 * that starts passing FAILS, so a fix cannot leave a carve-out behind that
 * silences a later regression.
 */
const NOT_A_FIXED_POINT = new Map<string, string>([
  [
    '344-a-comment-only-line-in-a-line-block-is-removed-before-any-inline-run',
    'a code value holding a blank line has no Carve spelling, and carve-php writes the same non-fixed-point',
  ],
])

/**
 * The one document the importer REFUSES, which is the refusal working.
 *
 * `182` nests openers past the import nesting cap, so there is no imported
 * source to be a fixed point of. Named rather than caught silently, so a
 * document that starts throwing for some OTHER reason is a failure and not a
 * skip.
 */
const REFUSED = new Set<string>(['182-openers-past-the-nesting-cap-are-one-paragraph'])

describe('an imported source is a carve fmt fixed point', () => {
  for (const name of cases) {
    const html = readFileSync(resolve(corpusDir, `${name}.html`), 'utf8')
    const carveOut = NOT_A_FIXED_POINT.get(name)

    if (REFUSED.has(name)) {
      it(`${name}: the importer refuses it, so there is no source to check`, () => {
        expect(() => htmlToCarve(html)).toThrow(HtmlImportLimitError)
      })
      continue
    }

    it(`${name}: ${carveOut === undefined ? 'the imported source is what the writer emits' : `KNOWN: ${carveOut}`}`, () => {
      const imported = htmlToCarve(html).value
      if (carveOut === undefined) expect(carveToCarve(imported)).toBe(imported)
      else expect(carveToCarve(imported)).not.toBe(imported)
    })
  }
})

describe('the carve-out list', () => {
  it('names only corpus documents that exist', () => {
    // A name-keyed entry that matches nothing excuses nothing and still reads
    // as a live, reasoned carve-out. Corpus files carry the spec's ordering
    // number, which shifts whenever a section is inserted upstream, so an entry
    // goes stale without anything in the diff saying so (#1363).
    const known = new Set(cases)
    const orphaned = [...NOT_A_FIXED_POINT.keys(), ...REFUSED].filter((n) => !known.has(n)).sort()
    expect(orphaned, 'entries naming no corpus document').toEqual([])
  })

  it('carries a reason for every entry', () => {
    // An entry nobody can explain is the next thing to investigate, not a
    // resident. Mirrors carve-php's ratchet, which fails an empty reason for
    // the same reason.
    const silent = [...NOT_A_FIXED_POINT].filter(([, reason]) => reason.trim() === '')
    expect(silent.map(([name]) => name)).toEqual([])
  })
})
