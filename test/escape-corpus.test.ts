/*
 * The shared escaper corpus (spec/tests/corpus-escape/), run against
 * `escapePlainCarveInlineSyntax` directly.
 *
 * This is the one function every migration converter runs before it writes
 * Carve, and until now nothing gated it. The conformance corpus pairs a .crv
 * with expected output per render target, so `compare:impls` covers everything
 * that READS Carve and nothing that writes it - which is why a converter fix
 * had to be ported between the three engines by hand, and why carve#1130 lists
 * six times a fix landed in one engine and not the others, four of them inside
 * this escaper.
 *
 * The cases are byte-exact by construction: a case asks "this text, escaped, is
 * exactly this Carve source", and the answer is a string. No render, no
 * semantic comparison, no dialect decision - which is why this subset went
 * first.
 *
 * SCOPE. The corpus pins the delimiter-run escaper and only that. The
 * constructs `escapeCarveConstructsSpelledLikeText` freezes in
 * markdown-migrate.ts - a math span, a literal span, an extension call, a
 * caption line, an inline footnote, an abbreviation definition, a fenced div,
 * an attributed span - are spelled as a bracket, a marker column or a
 * sigil-plus-code-span rather than as a delimiter run, and no case in the
 * corpus contains one. They need the converter corpus proper (carve#1130),
 * whose expectations are a migrated document rather than a string.
 *
 * carve-rs runs the same file from `escape_corpus` in src/djot_migrate.rs
 * (markup-carve/carve-rs#998).
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  escapePlainCarveInlineSyntax,
  HANDLED_DJOT,
  HANDLED_MARKDOWN,
  HANDLED_PLAIN,
  type HandledDelimiters,
} from '../src/carve-escape.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const corpusPath = resolve(__dirname, '../spec/tests/corpus-escape/cases.json')

if (!existsSync(corpusPath)) {
  throw new Error(
    `Escaper corpus not found at ${corpusPath}.\n` +
      `Did you initialize the submodule?\n` +
      `  git submodule update --init`,
  )
}

interface EscapeCase {
  name: string
  input: string
  expected: Record<string, string>
}

interface EscapeCorpus {
  version: number
  profiles: Record<string, { braced?: string; bare?: string }>
  cases: EscapeCase[]
}

const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as EscapeCorpus

/**
 * The profiles this package can produce, by the corpus's names.
 *
 * These are the sets the converters THEMSELVES pass, imported rather than
 * respelled here. A set restated in a test file is a set the call site can
 * drift away from with every case still passing, which is the shape of gate
 * this corpus exists to replace.
 *
 * `plain` is bbcode-migrate.ts, `markdown` is markdown-migrate.ts, and `djot`
 * has no caller in this package - see HANDLED_DJOT for why it is measured
 * anyway.
 */
const PROFILES: Record<string, HandledDelimiters> = {
  plain: HANDLED_PLAIN,
  markdown: HANDLED_MARKDOWN,
  djot: HANDLED_DJOT,
}

describe('the escaper corpus is actually read', () => {
  it('is a corpus version this runner understands', () => {
    // A shape change with the same filename would otherwise land as a silent
    // pass: every field this runner reads would come back undefined and every
    // comparison would be undefined against undefined.
    expect(corpus.version).toBe(1)
  })

  it('yields the cases and profiles it claims', () => {
    expect(corpus.cases.length).toBeGreaterThanOrEqual(50)
    expect(Object.keys(corpus.profiles).sort()).toEqual(['djot', 'markdown', 'plain'])

    const pairs = corpus.cases.flatMap((c) => Object.keys(c.expected))
    expect(pairs.length).toBeGreaterThanOrEqual(150)
  })

  it('leaves no profile unrun', () => {
    // The corpus tells an engine it MAY skip a profile it cannot produce. This
    // package can produce all three, so the skip list is empty and stays empty:
    // a profile added upstream and quietly skipped here is a case count that
    // grows while the coverage does not.
    const unrun = Object.keys(corpus.profiles).filter((p) => !(p in PROFILES))
    expect(unrun).toEqual([])
  })

  it('declares the same handled set as the corpus', () => {
    // The sets are spelled in two places - the corpus and this package - and a
    // drift between them leaves every case below passing while measuring a
    // question nobody asked.
    for (const [name, handled] of Object.entries(PROFILES)) {
      const declared = corpus.profiles[name]
      expect(declared, `corpus declares no profile ${name}`).toBeDefined()
      expect(declared?.braced ?? '', `${name}: braced handled set`).toBe(handled.braced ?? '')
      expect(declared?.bare ?? '', `${name}: bare handled set`).toBe(handled.bare ?? '')
    }
  })
})

describe('every escaper case matches byte for byte', () => {
  for (const testCase of corpus.cases) {
    for (const [profile, expected] of Object.entries(testCase.expected)) {
      const handled = PROFILES[profile]
      if (handled === undefined) continue

      it(`${testCase.name} [${profile}]`, () => {
        expect(escapePlainCarveInlineSyntax(testCase.input, handled)).toBe(expected)
      })
    }
  }
})

describe('the corpus invariants hold against this implementation', () => {
  it('only ever inserts backslashes', () => {
    // The corpus's own invariant, restated against the OUTPUT rather than the
    // fixture: an escaper that rewrites text instead of freezing it would pass
    // a hand-tuned expectation and fail this.
    for (const testCase of corpus.cases) {
      for (const [profile, handled] of Object.entries(PROFILES)) {
        const got = escapePlainCarveInlineSyntax(testCase.input, handled)
        expect(got.replace(/\\/g, ''), `${testCase.name} [${profile}] rewrote its input`).toBe(
          testCase.input,
        )
      }
    }
  })

  it('keeps the handled set load-bearing', () => {
    // The handled set is what separates the profiles. Were it ignored, every
    // profile would give the same answer and every case above would still pass,
    // because the corpus's expectations agree wherever the profiles do.
    expect(escapePlainCarveInlineSyntax('a *x* b', HANDLED_DJOT)).toBe('a *x* b')
    expect(escapePlainCarveInlineSyntax('a *x* b', HANDLED_PLAIN)).toBe('a \\*x* b')
    expect(escapePlainCarveInlineSyntax('a ~x~ b', HANDLED_MARKDOWN)).toBe('a ~x~ b')
    expect(escapePlainCarveInlineSyntax('a ~x~ b', HANDLED_PLAIN)).toBe('a \\~x~ b')
  })
})
