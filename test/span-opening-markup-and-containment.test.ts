import { readdirSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// @ts-expect-error - the executable spec ships plain ESM with no types.
import { checkContainment, checkOpeningMarkup } from '../spec/scripts/spec/ast-positions.mjs'

import { carveToAstJson } from '../src/index.js'

/**
 * PART 12 §4, as markup-carve/carve#913 settled it.
 *
 * A SPAN BEGINS AT THE CONSTRUCT'S OPENING MARKUP. A node's `pos` covers the
 * construct as WRITTEN - the `>` of a block quote, the `#` of a heading, a list
 * item's marker AND the indentation that places it, the `[` of a link, the
 * backtick run of a code block - so a span round-trips to the source text that
 * produced the node. Content-only was the alternative and is rejected
 * structurally: under it a nested construct's span is no longer contained by
 * its parent's, and the span tree stops being a tree.
 *
 * Paired with it: A PARENT'S SPAN CONTAINS EVERY CHILD'S. The two are enforced
 * in SEPARATE passes, deliberately. They point the same way today, which is
 * exactly why deriving one from the other would go quiet with nothing failing
 * if the convention were revisited.
 *
 * The checks are the spec's own - `checkOpeningMarkup` and `checkContainment`
 * from scripts/spec/ast-positions.mjs - so this cannot drift into a local
 * restatement of the rule. `checkOpeningMarkup` compares a span's first
 * non-indentation character against the markup its type is opened by, read from
 * the SOURCE, never against what the node says it holds. That distinction is the
 * whole point: the one content-level rule the conformance checker had asserted
 * that a span SLICES TO plausible text, and every real divergence preserves it.
 * Over `* * *`, carve-php publishes `text [0, 1]` where the other two publish
 * `[4, 5]`, and both slice to an asterisk.
 *
 * THE TRAP THIS TEST IS BUILT AROUND. Positions are an opt-in parse option in
 * carve-rs and carve-php, so a probe that does not request them yields a tree
 * with no `pos` anywhere - ZERO findings out of ZERO spans, which reads exactly
 * like a clean run. It is not a hypothetical: writing this test hit it, through
 * a different door (`carveToAstJson` returns an object and the probe called
 * `JSON.parse` on it, so every document was skipped and the run said "0
 * findings"). So presence is asserted before anything is compared, and the
 * counts are asserted to be LARGE rather than merely non-zero.
 */

const corpusDir = resolve(fileURLToPath(new URL('../spec/tests/corpus', import.meta.url)))
const names = readdirSync(corpusDir)
  .filter((f) => f.endsWith('.crv'))
  .sort()

interface Run {
  findings: string[]
  spans: number
  pairs: number
  documents: number
}

const run = (): Run => {
  const findings: string[] = []
  let spans = 0
  let pairs = 0
  let documents = 0
  for (const f of names) {
    const source = readFileSync(resolve(corpusDir, f), 'utf8')
    const doc = carveToAstJson(source, { positions: true })
    documents++
    const before = findings.length
    spans += checkOpeningMarkup(doc, [...source], findings) as number
    pairs += checkContainment(doc, findings) as number
    for (let i = before; i < findings.length; i++) {
      findings[i] = `${basename(f, '.crv')}: ${findings[i]}`
    }
  }

  return { findings, spans, pairs, documents }
}

describe('every span begins at the markup that opens it, and is contained by its parent', () => {
  const result = run()

  it('examined a tree that actually carries positions', () => {
    // BEFORE any comparison. Zero out of zero is the failure mode this whole
    // file is arranged against.
    expect(result.documents).toBeGreaterThan(700)
    expect(result.spans).toBeGreaterThan(1000)
    expect(result.pairs).toBeGreaterThan(3000)
  })

  it('reports nothing over the whole corpus', () => {
    expect(result.findings).toEqual([])
  })
})

describe('the two checks can fail', () => {
  // A rule that reports nothing over 787 documents is indistinguishable from a
  // rule that cannot report anything, which is the shape markup-carve/carve#755
  // catalogues. These perturb a real tree and assert each check sees it.
  const source = '> quoted\n\n- item\n\n# Heading\n'
  const tree = (): Record<string, unknown> =>
    JSON.parse(JSON.stringify(carveToAstJson(source, { positions: true })))

  it('checkOpeningMarkup reports a span moved off its marker', () => {
    const doc = tree()
    const quote = (doc.children as Array<Record<string, unknown>>)[0]!
    const pos = quote.pos as { startOffset: number }
    // Past the `>` and its space, onto the content - the content-only span the
    // ruling rejects.
    pos.startOffset += 2

    const findings: string[] = []
    const examined = checkOpeningMarkup(doc, [...source], findings) as number

    expect(examined).toBeGreaterThan(0)
    expect(findings.join('\n')).toContain('block_quote')
  })

  it('checkContainment reports a child that escapes its parent', () => {
    const doc = tree()
    const quote = (doc.children as Array<Record<string, unknown>>)[0]!
    const child = (quote.children as Array<Record<string, unknown>>)[0]!
    const pos = child.pos as { startOffset: number }
    pos.startOffset -= 5

    const findings: string[] = []
    const pairs = checkContainment(doc, findings) as number

    expect(pairs).toBeGreaterThan(0)
    expect(findings).not.toEqual([])
  })

  it('and a CONTROL: the unperturbed tree reports nothing', () => {
    const findings: string[] = []
    const examined = checkOpeningMarkup(tree(), [...source], findings) as number
    checkContainment(tree(), findings)

    expect(examined).toBeGreaterThan(0)
    expect(findings).toEqual([])
  })
})
