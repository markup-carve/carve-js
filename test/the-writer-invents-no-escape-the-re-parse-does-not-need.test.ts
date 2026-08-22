/*
 * PART 11 §2's OTHER HALF: the writer escapes a character IF AND ONLY IF
 * omitting the escape would change the re-parse.
 *
 * The "if" half is covered several times over - `render-carve.test.ts` sweeps
 * the corpus for `toHtml(fmt(x)) == toHtml(x)`, for idempotency and for a clean
 * re-parse, and `corpus-canonical-form.test.ts` pins the exact bytes of the
 * documents the spec ships a `.fmt` for. NOTHING measured the "only if" half,
 * and nothing above CAN: a tree comparison has to forgive escaping or §1
 * contradicts §2, and an over-escaped document renders identically, re-parses
 * cleanly and is happily idempotent. An invented escape passes every one of
 * them.
 *
 * That is not hypothetical. Two carve-php writer defects of exactly this shape -
 * a doubled caret (markup-carve/carve-php#1520) and a half-formed braced pair
 * (markup-carve/carve-php#1522) - both reached a human reading output, because
 * no automated check could see them.
 *
 * THE MEASUREMENT. For each corpus document take `carveToCarve`, then remove
 * each backslash on its own; a backslash whose removal leaves BOTH the render
 * and the canonical tree unchanged is an escape the re-parse never needed. The
 * same count is taken on the SOURCE and subtracted, so an escape the author
 * wrote and the writer merely carried through is not charged to the writer.
 *
 * THE READING, at spec `d164b12`: 72 invented escapes across 28 of 1341
 * documents - the same 28 slugs with the same 28 counts carve-php measured in
 * markup-carve/carve-php#1549. Two engines with independently written writers
 * landing on the same 72 is the finding: the debt is not this engine's escape
 * table, it is the shape both writers chose, and the two causes are the same.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { carveToCarve, carveToHtml, parse, toAstJson } from '../src/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const corpusDir = resolve(__dirname, '../spec/tests/corpus')

if (!existsSync(corpusDir)) {
  throw new Error(`Spec corpus not found at ${corpusDir}. Did you run: git submodule update --init`)
}

/**
 * The three causes measured here, one of which every ratchet entry must name.
 *
 * They were classified against THIS engine rather than inherited from carve-php:
 * the writer was instrumented to report, per document, whether its minimal and
 * conservative passes agreed and which form it returned. An entry belonging to
 * none of them is a cause nobody has looked at yet, which is a finding rather
 * than a resident.
 *
 * `escalation: ` was the fourth, and it is gone: PART 11 §2b narrowed the
 * fallback from the document to the failing unit, and every document that
 * carried an escape only because a DIFFERENT block needed one now writes it
 * bare. What the narrowing did NOT retire is split between the two causes that
 * replaced it, because the two are fixed by different work.
 */
const IDLE_ESCAPE_CAUSES = ['unit scope: ', 'opener run: ', 'minimal class: ']

/**
 * THE DEBT, NOT A BLESSING: documents where the writer emits an escape the
 * re-parse does not need, with the exact count of invented escapes.
 *
 * It is a shrink-only ratchet. An entry may be lowered or deleted as the writer
 * improves, and NOTHING may be added or raised. A count that goes up is a
 * regression and fails; a count that goes down fails too, so the entry is
 * tightened rather than left as slack a later defect could spend - which is the
 * whole difference between this and an allowlist.
 *
 * Every entry carries a reason naming the characters escaped for nothing,
 * because an entry nobody can explain is the next thing to investigate. An
 * empty reason, a zero count, or a slug the corpus does not have all fail below.
 *
 * UNIT SCOPE, the 20-document cause: PART 11 §4's two-render strategy has one
 * knob per unit - minimal or conservative - so a unit that fails is written
 * conservatively IN FULL, and every other candidate character in the same run
 * is escaped with the one that needed it. §2b bounds how far that reaches (the
 * run, or the block holding it, never the document) and this is what is left
 * inside the bound. Retiring it needs §2's own per-OPENER-OCCURRENCE test -
 * `\\{.note}` rather than `\\{\\.note\\}` - which is a different mechanism, not a
 * narrower scope.
 *
 * OPENER RUN, two documents: §2's THE UNIT IS THE OPENER requires the WHOLE
 * opener run escaped - `\\#\\# H` and not `\\## H`, `\\*\\*\\*` and not `\\***` - and
 * PART 11 §2b names the first of those as its own worked example. The sweep
 * below removes ONE backslash at a time, so it reads the second `\\#` as idle:
 * with the first still there no heading forms either way. These two entries are
 * therefore a floor this measurement cannot go below while §2 says what it
 * says, and they are here to be seen rather than to be fixed.
 *
 * MINIMAL CLASS, the other two: both passes agree, so nothing escalated, and
 * the escape is still idle - once because a literal backslash is written
 * doubled where the bare one re-parses the same, once because the writer's own
 * cell padding retired an authored escape it then kept.
 */
const IDLE_ESCAPE_RATCHET = new Map<string, [number, string]>([
  ['103-heading-marker-column-zero-2', [2, 'opener run: the heading opener `##` is escaped in full, and removing either backslash alone still leaves a paragraph']],
  ['129-emphasis-opener-slash-adjacency-3', [2, 'unit scope: the failing run is written conservatively in full, which escapes `_` x2 where the opener alone would do']],
  ['132-thematic-break-requires-contiguous-markers-3', [3, 'opener run: the break opener `***` is escaped in full, and removing any one backslash alone still leaves a paragraph']],
  ['146-table-as-a-block-opener-in-a-list-item-2', [3, 'unit scope: the failing run is written conservatively in full, which escapes `=`, `|` x2 beyond the opener']],
  ['151-indented-ordered-marker-content-column-includes-the-marker-indent', [1, 'unit scope: the failing run is written conservatively in full, which escapes the closing `|` beyond the opener']],
  ['157-indented-attribute-line-stays-literal', [3, 'unit scope: the failing run is written conservatively in full, which escapes `{`, `.`, `}` where any one of them alone stops the attribute line']],
  ['157-indented-attribute-line-stays-literal-2', [3, 'unit scope: the failing run is written conservatively in full, which escapes `{`, `.`, `}` where any one of them alone stops the attribute line']],
  ['158-indented-image-and-caption-stay-literal-2', [3, 'unit scope: the failing run is written conservatively in full, which escapes `{`, `.`, `}` where any one of them alone stops the attribute line']],
  ['159-indented-reference-and-footnote-definitions-stay-literal', [2, 'unit scope: the failing run is written conservatively in full, which escapes `]`, `/` beyond the opener']],
  ['159-indented-reference-and-footnote-definitions-stay-literal-2', [1, 'unit scope: the failing run is written conservatively in full, which escapes a `.` beyond the opener']],
  ['160-indented-colon-fence-blocks-stay-literal-2', [2, 'unit scope: the failing run is written conservatively in full, which escapes `:`, `|` beyond the opener']],
  ['195-a-definition-inside-a-container-is-collected-at-that-container-s-content-column-3', [3, 'unit scope: the failing run is written conservatively in full, which escapes `[`, `]`, `/` where any one of them alone stops the definition']],
  ['218-a-footnote-body-s-own-column-is-two-and-a-third-column-is-its-text', [4, 'unit scope: the failing run is written conservatively in full, which escapes `|` x3, `-` beyond the openers']],
  ['219-a-definition-below-a-footnote-body-s-column-is-the-document-s-own-text', [2, 'unit scope: the failing run is written conservatively in full, which escapes `]`, `/` beyond the opener']],
  ['220-a-definition-past-a-footnote-body-s-column-is-the-body-s-own-text', [2, 'unit scope: the failing run is written conservatively in full, which escapes `]`, `/` beyond the opener']],
  ['287-a-column-zero-definition-ends-an-open-list-item-3', [2, 'unit scope: the failing run is written conservatively in full, which escapes `]`, `/` beyond the opener']],
  ['322-an-attribute-block-reaches-the-nested-list-it-precedes-9', [3, 'unit scope: the failing run is written conservatively in full, which escapes `{`, `.`, `}` where any one of them alone stops the attribute line']],
  ['350-a-definition-at-a-container-s-content-column-3', [2, 'unit scope: the failing run is written conservatively in full, which escapes `]`, `/` beyond the opener']],
  ['369-a-quote-is-reached-by-its-marker-and-a-column-never-reaches-into-one', [2, 'unit scope: the failing run is written conservatively in full, which escapes `]`, `/` beyond the opener']],
  ['369-a-quote-is-reached-by-its-marker-and-a-column-never-reaches-into-one-2', [2, 'unit scope: the failing run is written conservatively in full, which escapes `]`, `/` beyond the opener']],
  ['369-a-quote-is-reached-by-its-marker-and-a-column-never-reaches-into-one-3', [2, 'unit scope: the failing run is written conservatively in full, which escapes `]`, `/` beyond the opener']],
  ['390-a-table-cell-s-marker-run-ends-at-a-space-5', [1, 'minimal class: an authored `\\=` is kept after the writer\'s own cell padding retired it - padded, the `=` no longer starts the cell']],
  ['72-escape-coverage-2', [4, 'minimal class: a literal backslash is written doubled, and a lone backslash before a non-escapable character re-parses the same bare']],
  ['87-compact-list-blocks-10', [3, 'unit scope: the failing run is written conservatively in full, which escapes `{`, `.`, `}` where any one of them alone stops the attribute line']],
])

/**
 * Key-order-insensitive, position-free view of an AST-JSON tree.
 *
 * `pos` and `srcByteLength` say where the text sat rather than what it says,
 * and removing a backslash shifts every offset after it - compared, they would
 * report a difference on EVERY escape and the count would be a structural zero.
 * They are the only offset-bearing fields the wire format has today; a future
 * one would silently make this measurement too lenient, which is what the
 * footnote document in the self-check below is there to catch.
 *
 * `escaped_text` is folded into `text` and adjacent text runs are merged,
 * because an escape is exactly what this comparison is deciding: without it
 * every backslash would split one text node into three and read as load-bearing.
 *
 * NOT INTO `attrs`. It holds named slots rather than nodes, and an author can
 * spell an attribute `type`, `pos` or `srcByteLength` - descending would rename
 * or delete an ATTRIBUTE. Attributes are content, so they compare verbatim.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    const out: unknown[] = []
    for (const raw of value) {
      const child = canonical(raw)
      const last = out.length === 0 ? undefined : out[out.length - 1]
      if (isTextRun(child) && isTextRun(last)) {
        last['value'] = String(last['value']) + String(child['value'])
        continue
      }
      out.push(child)
    }
    return out
  }
  if (value === null || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    if (key === 'pos' || key === 'srcByteLength') continue
    const raw = (value as Record<string, unknown>)[key]
    out[key] = key === 'attrs' ? raw : canonical(raw)
  }
  if (out['type'] === 'escaped_text') out['type'] = 'text'
  return out
}

function isTextRun(node: unknown): node is Record<string, unknown> {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return false
  const keys = Object.keys(node as Record<string, unknown>)
  return (
    keys.length === 2 &&
    keys.includes('type') &&
    keys.includes('value') &&
    (node as Record<string, unknown>)['type'] === 'text'
  )
}

/**
 * The render and the canonical tree of a document as one comparable string, or
 * null when the document does not parse at all.
 *
 * Both halves are needed. The tree comparison forgives escaping - it has to, or
 * §1 contradicts §2 - so on its own it would call EVERY escape idle. The render
 * is what still separates an escape that changes the document from one that
 * changes nothing.
 */
function fingerprint(source: string): string | null {
  try {
    return carveToHtml(source) + ' ' + JSON.stringify(canonical(toAstJson(parse(source))))
  } catch {
    return null
  }
}

/**
 * A document's IDLE escapes, counted PER ESCAPED CHARACTER - §2's "only if".
 *
 * Each backslash is removed on its own and the document re-measured. One whose
 * removal leaves both the render and the canonical tree unchanged is counted
 * under the character it was escaping. A removal that makes the document
 * unparseable is not idle: the fingerprint is null, which matches nothing.
 */
function idleEscapes(source: string): Map<string, number> {
  const idle = new Map<string, number>()
  const base = fingerprint(source)
  if (base === null) return idle
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '\\') continue
    if (fingerprint(source.slice(0, i) + source.slice(i + 1)) !== base) continue
    const escaped = i + 1 < source.length ? source[i + 1]! : ''
    idle.set(escaped, (idle.get(escaped) ?? 0) + 1)
  }
  return idle
}

/**
 * The idle escapes the WRITER added, over the ones the author already had.
 *
 * THE SUBTRACTION IS PER CHARACTER AND CLAMPED AT ZERO PER CHARACTER. A
 * document-wide total would let the writer pay for a newly invented escape with
 * an unrelated one it retired - drop two of the author's idle `.` escapes,
 * invent an idle `|`, and the net is negative while a new defect is on the page.
 * Per character, the invented `|` still counts. Clamping per character is what
 * keeps that sound: retiring an author's escape is §2's job, not credit.
 *
 * BOTH READINGS WERE TAKEN before this was seeded, and on this corpus they agree
 * exactly - 28 documents and 72 escapes, per character and as a document total.
 * The per-character one is kept because it is the one that stays honest when
 * they stop agreeing.
 *
 * What is left is a FLOOR, not an exact count. THE RESIDUAL BLIND SPOT is two
 * idle escapes of the SAME character, one retired and one invented elsewhere in
 * the same document: those still cancel. Positional matching would close it, and
 * nothing in the corpus exercises it today.
 */
function inventedIdleEscapes(source: string): number {
  return inventedIdleEscapesBetween(source, carveToCarve(source))
}

/** The same count between any two spellings, so the property above can be shown without the writer. */
function inventedIdleEscapesBetween(source: string, formatted: string): number {
  if (!source.includes('\\') && !formatted.includes('\\')) return 0
  const authored = idleEscapes(source)
  let invented = 0
  for (const [escaped, count] of idleEscapes(formatted)) {
    invented += Math.max(0, count - (authored.get(escaped) ?? 0))
  }
  return invented
}

const cases = readdirSync(corpusDir)
  .filter((f) => f.endsWith('.crv'))
  .map((f) => basename(f, '.crv'))
  .sort()

describe('the writer invents no escape the re-parse does not need', () => {
  it('sweeps a corpus that is actually there', () => {
    // A glob that quietly matches nothing is how a checker reports success
    // having compared nothing (markup-carve/carve#671). The ratchet alone would
    // not catch it: with no documents, every entry is simply never visited.
    expect(cases.length).toBeGreaterThan(1000)
  })

  for (const name of cases) {
    it(`${name}`, () => {
      const allowed = IDLE_ESCAPE_RATCHET.get(name)?.[0] ?? 0
      const invented = inventedIdleEscapes(readFileSync(resolve(corpusDir, `${name}.crv`), 'utf8'))
      const message =
        invented > allowed
          ? `the writer invented ${invented} escape(s) the re-parse does not need in ${name}, and the ratchet allows ${allowed}. ` +
            'PART 11 §2 escapes a character only if omitting it would change the re-parse. ' +
            'The ratchet may only shrink, so this is a regression to fix, not an entry to raise.'
          : `the ratchet entry for ${name} is stale: it records ${allowed} invented escape(s) and the writer now emits ${invented}. ` +
            `Lower the entry to ${invented} (or delete it at 0) so the debt cannot grow back into the slack.`
      expect(invented, message).toBe(allowed)
    })
  }
})

describe('the idle-escape ratchet', () => {
  it('names only real documents, with a count and a cause', () => {
    for (const [slug, [count, reason]] of IDLE_ESCAPE_RATCHET) {
      expect(cases, `the ratchet names a document the corpus does not have: ${slug}`).toContain(slug)
      expect(count, `a ratchet entry records no invented escape, so it is not debt: ${slug}`).toBeGreaterThan(0)
      expect(
        reason.trim(),
        `the ratchet entry for ${slug} has no reason, and an entry nobody can explain is the next thing to investigate`,
      ).not.toBe('')
      expect(
        IDLE_ESCAPE_CAUSES.some((cause) => reason.startsWith(cause)),
        `the ratchet entry for ${slug} names no measured cause: ${reason}`,
      ).toBe(true)
    }
  })

  it('is the reading this commit measured, and only ever less', () => {
    // The headline number, pinned where a reader can find it.
    //
    // REDUNDANT BY DESIGN. The per-document assertion above is an EQUALITY, so
    // raising an entry already fails as stale and adding one for a clean
    // document already fails at 0 - the shrink-only rule is enforced entry by
    // entry, not by this ceiling. What this adds is a single place the reading
    // is written down, so a reader does not have to sum 28 numbers, and one
    // line that moves when the debt does.
    let total = 0
    for (const [, [count]] of IDLE_ESCAPE_RATCHET) total += count
    expect(total).toBeLessThanOrEqual(57)
    expect(IDLE_ESCAPE_RATCHET.size).toBeLessThanOrEqual(24)
  })
})

describe('the idle sweep', () => {
  it('sees an invented escape and keeps a needed one', () => {
    // THE SWEEP CAN FAIL, and it fails on exactly what §2 forbids. Without this
    // the whole check could be a count that is structurally always zero.

    // Idle: mid-line, a `>` is text with or without the backslash.
    expect([...idleEscapes('a \\> b\n')]).toEqual([['>', 1]])

    // Needed: at column zero, bare it opens a quote.
    expect([...idleEscapes('\\> a\n')]).toEqual([])

    // And the count is backslashes that do nothing, not backslashes.
    expect([...idleEscapes('a > b\n')]).toEqual([])
    expect([...idleEscapes('a b\n')]).toEqual([])
  })

  it('is not blinded by a position-bearing field', () => {
    // The one way this measurement could go quietly lenient: an offset-bearing
    // field reaching the fingerprint. Removing a backslash shifts every offset
    // after it, so a document carrying one would report a difference for EVERY
    // escape and count none of them idle. A footnote is the field that bit the
    // writer's own comparison (`footnoteDefPos`), so the idle `>` has to still
    // be visible with one on the page.
    expect([...idleEscapes('a \\> b[^x]\n\n[^x]: c\n')]).toEqual([['>', 1]])
  })

  it('counts per character, so a retired escape cannot pay for an invented one', () => {
    // The same total, a different character, is still one invented escape.
    expect(inventedIdleEscapesBetween('a \\. b\n', 'a \\| b\n')).toBe(1)
    expect(inventedIdleEscapesBetween('a \\. b\n', 'a \\. b\n')).toBe(0)
    // Two retired, one invented: a document total reads -1 and reports nothing.
    expect(inventedIdleEscapesBetween('a \\. b \\. c\n', 'a . b . c \\| d\n')).toBe(1)
  })
})
