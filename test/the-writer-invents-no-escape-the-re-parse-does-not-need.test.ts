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
 * THE MEASUREMENT. For each corpus document take `carveToCarve`, then remove each
 * opener run whole; a run whose removal leaves BOTH the render and the canonical
 * tree unchanged is escapes the re-parse never needed, counted at its length. The
 * same count is taken on the SOURCE and subtracted, so an escape the author wrote
 * and the writer merely carried through is not charged to the writer.
 *
 * THE READING, and how it moved. Seeded at 72 invented escapes across 28 of
 * 1341 documents - the same slugs with the same counts carve-php measured in
 * markup-carve/carve-php#1549, which is what made it a shape both writers chose
 * rather than this engine's escape table. PART 11 §2b narrowed the fallback
 * from the document to the failing unit and left 57 across 24
 * (markup-carve/carve#1516), which the pin then carried to 59 across 25 when
 * §2b's own corpus document arrived (markup-carve/carve#1549). §2's
 * per-OPENER-OCCURRENCE test retires the 47 that were one unit written
 * conservatively in full, and leaves 12 across 5 (markup-carve/carve#1533).
 * Asking §2's question of the OPENER rather than of the byte then took it to 3
 * across 2, which is where it stands; carve-php measures the same 2 with the same
 * counts (markup-carve/carve-php#2645).
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
 * The one cause measured here, which every ratchet entry must name.
 *
 * It was classified against THIS engine rather than inherited from carve-php: the
 * writer was instrumented to report, per document, whether its minimal and
 * conservative passes agreed and which form it returned. An entry belonging to no
 * measured cause is one nobody has looked at yet, which is a finding rather than a
 * resident.
 *
 * THREE HAVE BEEN RETIRED. `escalation: ` went when PART 11 §2b narrowed the
 * fallback from the document to the failing unit, and `unit scope: ` went when
 * §2's test was taken per opener occurrence inside that unit
 * (markup-carve/carve#1533). `opener run: ` went when the sweep started asking
 * §2's question of the opener rather than of the byte, which is the only one of
 * the three the WRITER never had a part in.
 */
const IDLE_ESCAPE_CAUSES = ['minimal class: ']

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
 * `unit scope` WAS THE 20-DOCUMENT CAUSE AND IS GONE (markup-carve/carve#1533).
 * PART 11 §4's strategy had one knob per unit, so a unit that failed was
 * written conservatively IN FULL and every candidate in it was escaped beside
 * the one that needed it. §2 takes the decision per OPENER OCCURRENCE, and the
 * writer now runs the same halving search one level finer: 20 documents and 47
 * escapes retired, `\\{.note}` where the unit-scoped form wrote `\\{\\.note\\}`.
 *
 * `opener run` WAS THE OTHER FOUR AND IS GONE TOO, as an artifact of the sweep
 * rather than of the writer. §2's THE UNIT IS THE OPENER requires the WHOLE
 * opener run escaped - `\\#\\# H` and not `\\## H`, `\\*\\*\\*` and not `\\***` - and
 * PART 11 §2b names the first of those as its own worked example. The sweep
 * removed ONE backslash at a time, so every backslash in a load-bearing run
 * answered "idle" on its own: with the others still there no heading formed
 * either way. What that scored was the half-escaped run §2 forbids, which the
 * occurrence search cannot even reach, so the four entries measured a spelling
 * no writer was allowed to emit. The sweep now puts §2's own question to the run
 * whole (see `escapedOpenerRuns`) and all four read 0.
 *
 * The fourth of them was the one this repository had just raised the ratchet for.
 * `509-a-fence-closer-below-a-nested-item-s-column-ends-containers-down-to-its-owner-8`
 * (markup-carve/carve#2509) writes a top-level paragraph whose whole text is
 * `~~~`, and CARVE-P11-006 rules that spelling outright: the escaped form of a
 * suppressed opener is the whole opener escaped. Raising the ceiling to 15 / 6
 * for it read the artifact as debt; carve-php reached the same wall and corrected
 * the measure instead (markup-carve/carve-php#2645).
 *
 * MINIMAL CLASS, the two that are left: both passes agree, so nothing escalated,
 * and the escape is still idle - once because a literal backslash is written
 * doubled where the bare one re-parses the same, once because the writer's own
 * cell padding retired an authored escape it then kept. Grouping cost
 * `72-escape-coverage-2` two of its four as well, because a doubled backslash is
 * ONE escape and was being judged as two. Both are §2 defects in the escape
 * logic and are fixed on their own merits.
 */
const IDLE_ESCAPE_RATCHET = new Map<string, [number, string]>([
  ['390-a-table-cell-s-marker-run-ends-at-a-space-5', [1, 'minimal class: an authored `\\=` is kept after the writer\'s own cell padding retired it - padded, the `=` no longer starts the cell']],
  ['72-escape-coverage-2', [2, 'minimal class: a literal backslash is written doubled, and a lone backslash before a non-escapable character re-parses the same bare']],
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
 * Each opener run is removed whole and the document re-measured. A run whose
 * removal leaves both the render and the canonical tree unchanged is idle, and
 * counts its whole length under the character it was escaping. A removal that
 * makes the document unparseable is not idle: the fingerprint is null, which
 * matches nothing.
 */
function idleEscapes(source: string): Map<string, number> {
  const idle = new Map<string, number>()
  const base = fingerprint(source)
  if (base === null) return idle
  for (const [offsets, escaped] of escapedOpenerRuns(source)) {
    let without = source
    for (const offset of [...offsets].reverse()) {
      without = without.slice(0, offset) + without.slice(offset + 1)
    }
    if (fingerprint(without) !== base) continue
    idle.set(escaped, (idle.get(escaped) ?? 0) + offsets.length)
  }
  return idle
}

/**
 * The backslash offsets of a source, grouped into OPENER RUNS.
 *
 * §2's "only if" is asked of the OPENER, not of the byte: where a construct
 * opens on a RUN of characters the whole run is escaped, so a run's backslashes
 * stand or fall together and the question to put to the re-parse is whether the
 * run is load bearing.
 *
 * Removing them one at a time cannot ask that. Every backslash in a load-bearing
 * run answers "idle" on its own, because the run is still broken by the ones
 * that remain: `\~\~\~` at column zero scored three idle escapes, and the
 * half-escaped `\~~~` that score implies is the spelling CARVE-P11-006 forbids
 * rather than one the writer may emit.
 *
 * A run is maximal and same-character: `\~\~\~` is one, `\~\-` is two. A doubled
 * backslash is consumed whole, because reading its second half as another opener
 * would pair it with whatever follows.
 */
function escapedOpenerRuns(source: string): Array<[number[], string]> {
  const runs: Array<[number[], string]> = []
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '\\') continue
    const escaped = i + 1 < source.length ? source[i + 1]! : ''
    const offsets = [i]
    i += escaped === '' ? 1 : 2
    while (escaped !== '' && i + 1 < source.length && source[i] === '\\' && source[i + 1] === escaped) {
      offsets.push(i)
      i += 2
    }
    i--
    runs.push([offsets, escaped])
  }
  return runs
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
 * BOTH READINGS WERE TAKEN before this was seeded, and on the corpus of the day
 * they agreed exactly, per character and as a document total. The per-character
 * one is kept because it is the one that stays honest when they stop agreeing.
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
    // is written down, so a reader does not have to sum the entries, and one
    // line that moves when the debt does.
    let total = 0
    for (const [, [count]] of IDLE_ESCAPE_RATCHET) total += count
    expect(total).toBeLessThanOrEqual(3)
    expect(IDLE_ESCAPE_RATCHET.size).toBeLessThanOrEqual(2)
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

    // AND THE SAME BOTH WAYS FOR A RUN, which is the half a per-byte sweep could
    // not ask: §2 escapes the whole opener, so the run stands or falls together.
    // Mid-line `##` opens nothing and both escapes are idle; at column zero the
    // run opens a heading and neither is.
    expect([...idleEscapes('a \\#\\# b\n')]).toEqual([['#', 2]])
    expect([...idleEscapes('\\#\\# H\n')]).toEqual([])
    expect([...idleEscapes('a \\~\\~\\~ b\n')]).toEqual([['~', 3]])
    expect([...idleEscapes('\\~\\~\\~\n\ntail\n')]).toEqual([])

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
