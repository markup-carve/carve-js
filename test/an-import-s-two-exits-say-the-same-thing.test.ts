import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { htmlToCarve, htmlToAst, parse } from '../src/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtureDir = resolve(__dirname, '../spec/tests/html-import')

if (!existsSync(fixtureDir)) {
  throw new Error(
    `Shared HTML import fixtures not found at ${fixtureDir}.\n` +
      `Did you initialize the submodule?\n` +
      `  git submodule update --init`,
  )
}

/**
 * markup-carve/carve#1609 ruled three shapes an import came back from meaning
 * something else, and stated the general rule they all break, in
 * `docs/html-import.md` under "The two exits say the same thing":
 *
 *     parse(htmlToCarve(h)) == htmlToAst(h)
 *
 * modulo escaping (PART 11 §1) and source positions, with a
 * `structure-unspellable` row as the only carve-out.
 *
 * NOTHING COMPARED THE TWO BEFORE. Every runner reads a fixture's
 * `expected.ast.json` against the engine and its `expected.crv` against the same
 * engine, and neither against the other, so an importer whose tree and whose
 * source disagree is green twice. That is how all three shapes reached the
 * contract page.
 *
 * The spec repo checks this off the FIXTURE BYTES, which is all it can reach
 * from there. This checks it against the LIVE importer over the same inputs,
 * which is the check the ruling asks each engine for and is strictly stronger:
 * the bytes only record what an import once produced.
 *
 * THE THREE SHAPES WERE FIXED IN #1373, WITHOUT TESTS - the pin bump carried the
 * source change and rested on the three shared fixtures arriving with it. This
 * is the gate that was still missing, plus the BOUNDS no fixture holds: which
 * caret is a marker, which colon opens a shortcode, and that no route rebuilds a
 * destination a security rule removed. A fixture records one input; the "only
 * if" half of PART 11 §2 is a claim about every other one.
 */

/** Fields that record WHERE a node was written, not what it is (PART 11 §1). */
const LOCATION_FIELDS = new Set(['pos', 'srcByteLength'])

/**
 * Fields that record HOW a source spelled a construct - which bullet character,
 * which ordered delimiter, which slot an attribute sat in. A parse fills them
 * because it read source; an import records none of them, because it read HTML
 * and there was no source to read them off.
 *
 * THE LIST IS CLOSED, and copied from the spec's own check so the two cannot
 * drift. Skipping every key missing from either side instead would be a check
 * that cannot fail for a whole class: a recorded `{type: 'text', value: 'x'}`
 * beside a parsed `{type: 'text'}` would agree, on nothing.
 */
const SOURCE_LAYOUT_FIELDS = new Set([
  'order',
  'bulletChar',
  'bareMarker',
  'delim',
  'definitionLines',
  'definitionSpans',
  'termSpans',
])

/**
 * MODULO ESCAPING, which PART 11 §1 requires: `escaped_text` and `text` compare
 * equal, and an adjacent run of them compares as the single text node holding
 * the same characters. Without it the invariant is unattainable by construction
 * for every source carrying an escape - which two of the three ruled shapes do.
 */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    const out: unknown[] = []
    for (const item of value.map(normalize)) {
      const previous = out.at(-1) as { type?: string; value?: string } | undefined
      const next = item as { type?: string; value?: string } | null
      if (previous?.type === 'text' && next?.type === 'text') {
        out[out.length - 1] = { type: 'text', value: previous.value! + next.value! }
        continue
      }
      out.push(item)
    }
    return out
  }
  if (value === null || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value)) {
    if (!LOCATION_FIELDS.has(key)) out[key] = normalize(inner)
  }
  if (out.type === 'escaped_text') out.type = 'text'
  return out
}

/** The first place the two exits differ, named, or null when they agree. */
function disagreement(parsed: unknown, recorded: unknown, path = ''): string | null {
  if (Array.isArray(parsed) || Array.isArray(recorded)) {
    if (!Array.isArray(parsed) || !Array.isArray(recorded)) return `${path}: array against non-array`
    if (parsed.length !== recorded.length) {
      return `${path}: ${parsed.length} parsed, ${recorded.length} recorded`
    }
    for (let i = 0; i < parsed.length; i++) {
      const miss = disagreement(parsed[i], recorded[i], `${path}[${i}]`)
      if (miss) return miss
    }
    return null
  }
  if (parsed !== null && typeof parsed === 'object' && recorded !== null && typeof recorded === 'object') {
    const left = parsed as Record<string, unknown>
    const right = recorded as Record<string, unknown>
    for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])]) {
      if (SOURCE_LAYOUT_FIELDS.has(key)) continue
      if (!(key in left)) return `${path}.${key}: the source says nothing, the tree says it`
      if (!(key in right)) return `${path}.${key}: the source says it, the tree says nothing`
      const miss = disagreement(left[key], right[key], `${path}.${key}`)
      if (miss) return miss
    }
    return null
  }

  return parsed === recorded
    ? null
    : `${path}: source says ${JSON.stringify(parsed)}, tree says ${JSON.stringify(recorded)}`
}

const wire = (value: unknown): unknown => normalize(JSON.parse(JSON.stringify(value)))

function twoExits(html: string): string | null {
  const source = htmlToCarve(html)
  // The one carve-out the contract page names: a tree Carve source cannot spell
  // survives in the AST and not in the source, and the row says so.
  if (source.report.diagnostics.some((row) => row.code === 'structure-unspellable')) return null

  return disagreement(wire(parse(source.value)), wire(htmlToAst(html).value))
}

/**
 * DECLARED, NEVER TOLERATED. The entries are the spec's own, found by writing
 * this check upstream rather than by the ruling that shipped it. The ledger
 * fails in BOTH directions, so a line goes out with the commit that fixes it
 * rather than outliving it as slack.
 *
 * TWO WENT OUT THAT WAY. The `<figure>` pair was RULED rather than tolerated
 * (markup-carve/carve#1606): the TREE was the wrong exit, because PART 9 §4b's
 * hosts are "an image, a quote, a code block, a display-math paragraph" - the
 * image host is the image, and only the math host is a paragraph. The tree it
 * used to return is held as a literal below, so retiring the entries does not
 * retire the proof.
 */
const UNMET = new Map<string, string>([
  [
    'derived-endnotes-section',
    'the tree says a one-item list is loose where its own source says tight, and Carve has no spelling for a loose one-item list (markup-carve/carve#1607)',
  ],
])

const fixtures = readdirSync(fixtureDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

describe("an import's two exits say the same thing", () => {
  for (const name of fixtures) {
    const html = readFileSync(resolve(fixtureDir, name, 'input.html'), 'utf8')
    const declared = UNMET.get(name)

    it(`${name}: ${declared === undefined ? 'the source and the tree agree' : `KNOWN: ${declared}`}`, () => {
      const miss = twoExits(html)
      if (declared === undefined) expect(miss, `${name} breaks the invariant`).toBeNull()
      else expect(miss, `${name} now MEETS the invariant - delete its entry`).not.toBeNull()
    })
  }

  it('declares only fixtures that exist', () => {
    // A name-keyed entry matching nothing excuses nothing and still reads as a
    // live, reasoned carve-out (#1363's guard, same shape).
    const known = new Set(fixtures)
    expect([...UNMET.keys()].filter((n) => !known.has(n)).sort()).toEqual([])
  })
})

/**
 * The three shapes markup-carve/carve#1609 ruled, and the bounds on each.
 *
 * The exact bytes are here beside the bounds ON PURPOSE, even though the shared
 * fixtures now record them too. A fixture is one input: it says the escape is
 * written where it is needed and says nothing about where it must NOT be, which
 * is the other half of PART 11 §2 and the half a writer gets wrong silently -
 * over-escaping passes every gate the project runs, which is why carve#581
 * exists. The rows below that pin `| x^ |`, `a : b : c` and `x:rocket:` bare are
 * the ones no fixture can carry.
 */
describe('the three shapes the import contract now rules', () => {
  it('escapes a cell whose whole payload is a span marker', () => {
    // PART 11 §2 already required this and PART 11 §6f now says why the cell
    // padding does not cover it: `rowspan_marker = {space}, '^', {space}` is
    // written WITH the padding inside it, so the space the writer puts around
    // every payload puts nothing out of reach.
    //
    // One production, two markers, and only the colspan half was escaped: a
    // cell holding a caret came back `| ^ |`, re-read as a rowspan marker, and
    // was DELETED - the cell above it growing `rowspan="2"` instead.
    const html = '<table><tr><td>a</td><td>b</td></tr><tr><td>^</td><td>&lt;</td></tr></table>'
    expect(htmlToCarve(html).value).toBe('| a | b |\n| \\^ | \\< |\n')
    expect(twoExits(html)).toBeNull()
  })

  it('escapes only a lone caret, because that is the whole production', () => {
    // The bound. A caret that is not the cell's entire payload opens nothing,
    // so §2's "only if" half forbids the escape there.
    expect(htmlToCarve('<table><tr><td>x^</td></tr></table>').value).toBe('| x^ |\n')
    expect(htmlToCarve('<table><tr><td>^ ^</td></tr></table>').value).toBe('| ^ ^ |\n')
  })

  it('escapes the symbol sigil', () => {
    // `:` is already in PART 11 §5's candidate set and `parse` yields a `symbol`
    // node unconditionally, so §2 already required this - the writer just knew
    // only the two LINE-opening colons (`::` a term, `:::` a fence) and read a
    // mid-line one as ordinary punctuation. Under a configured symbol map the
    // glyph rendered where the HTML held the text.
    const html = '<p>a :rocket: b and a #t tag</p>'
    expect(htmlToCarve(html).value).toBe('a \\:rocket: b and a \\#t tag\n')
    expect(twoExits(html)).toBeNull()
  })

  it('escapes the OPENING colon only, and leaves a colon that opens nothing', () => {
    // The bound again, and the harder half: the corpus pins `a : b : c`
    // unchanged. The writer asks the parser's own opening test rather than a
    // predicate of its own, so it cannot escape a colon the parser would not
    // have claimed - no name follows either colon here.
    expect(htmlToCarve('<p>a : b : c</p>').value).toBe('a : b : c\n')
    // The CLOSING colon of a shortcode opens nothing either: with the opener
    // escaped there is no symbol, and a second backslash would be idle.
    expect(htmlToCarve('<p>a :rocket: b</p>').value).toBe('a \\:rocket: b\n')
    // A colon glued to a word character cannot open one at all (the parser's
    // word-boundary guard), so it stays bare.
    expect(htmlToCarve('<p>x:rocket: y</p>').value).toBe('x:rocket: y\n')
  })

  it('writes no link or image where the HTML names no destination', () => {
    // The new rule. `[x]()` re-parses as literal text, so the four punctuation
    // characters were the whole of what the import added - and `[t](){#k}`
    // re-read its trailing block as a TAG node rather than as the link's
    // attributes.
    const html = '<p><a href="">click here</a> and <a id="k">a named one</a></p>\n<img src="" alt="logo">'
    const result = htmlToCarve(html)
    expect(result.value).toBe('click here and [a named one]{#k}\n\nlogo\n')
    expect(twoExits(html)).toBeNull()
    expect(
      result.report.diagnostics.map((row) => ({ code: row.code, message: row.message, severity: row.severity })),
    ).toEqual([
      { code: 'element-unwrapped', message: 'Unwrapped <a> with no destination', severity: 'info' },
      { code: 'element-unwrapped', message: 'Unwrapped <a> with no destination', severity: 'info' },
      { code: 'element-unwrapped', message: 'Unwrapped <img> with no source', severity: 'info' },
    ])
  })

  it('treats a whitespace-only destination as no destination', () => {
    // "Empty means the string is zero length, or zero length once leading and
    // trailing ASCII whitespace is stripped" - the HTML whitespace set.
    expect(htmlToCarve('<p><a href="   ">t</a></p>').value).toBe('t\n')
    expect(htmlToCarve('<p><a href="\n\t">t</a></p>').value).toBe('t\n')
    expect(htmlToCarve('<img src=" " alt="a">').value).toBe('a\n')
    // A destination that survives the strip is still a destination. The
    // writer percent-encodes the spaces it keeps, which is unchanged behavior.
    expect(htmlToCarve('<p><a href=" /u ">t</a></p>').value).toBe('[t](%20/u%20)\n')
  })

  it('NEVER rebuilds the destination, in any mode', () => {
    // THE SECURITY HALF. `href=""` is what PART 9 §25's URL sink denylist emits
    // when it blanks a dangerous scheme, and it writes no provenance - so any
    // route producing a destination here reconstructs the exact value a
    // security rule removed. Not from a title, not from the anchor's text, not
    // from provenance in `roundtrip` mode.
    const hostile = '<p><a href="" title="javascript:alert(1)">javascript:alert(1)</a></p>'
    for (const mode of ['safe', 'semantic', 'roundtrip'] as const) {
      const out = htmlToCarve(hostile, { mode }).value
      expect(out, `mode ${mode}`).not.toContain('](')
      expect(out, `mode ${mode}`).not.toContain('href')
    }
  })

  it('keeps an unwrapped image out of the image slot entirely', () => {
    // An image's content is its alternative text, and that is all there is to
    // stand in its place. With no alt there is nothing to write.
    expect(htmlToCarve('<img src="" alt="">').value).toBe('\n')
    expect(htmlToCarve('<img alt="a" id="i" src="">').value).toBe('[a]{#i}\n')
  })
})

/**
 * THE SHAPE THE `<figure>` PAIR USED TO BREAK, kept after their ledger entries
 * went out (markup-carve/carve#1606, markup-carve/carve-js#1381).
 *
 * A retired declaration takes its proof with it unless the proof is written
 * down somewhere else: the two fixtures now pass the sweep above, and nothing
 * there says WHICH tree they settled on, so a regression to the wrapper would
 * be caught only by the shared fixture bytes - one input, in another
 * repository, behind a pin. These assert the rule against the live importer,
 * in both directions.
 */
describe('a caption target is the captioned block, not a paragraph around it', () => {
  const figure = (html: string) => (htmlToAst(html).value.children[0] as { target?: unknown }).target

  it('gives a bare image target as the image itself', () => {
    // PART 9 §4b: "an image, a quote, a code block, a display-math paragraph".
    // The image host is the image, and this is the node `parse` builds from the
    // source written beside it - which is the invariant this file is about.
    const html = '<figure><img src="i.png" alt="a"><figcaption>cap</figcaption></figure>'
    expect(figure(html)).toEqual({ type: 'image', src: 'i.png', alt: 'a' })
    expect(htmlToCarve(html).value).toBe('![a](i.png)\n^ cap\n')
  })

  it('unwraps an authored <p> that only wraps the image, and keeps the image attributes', () => {
    // The paragraph a bare inline arrives in is SYNTHESIZED by `blocks()`,
    // whether the HTML spelled a `<p>` around it or not, so taking it off drops
    // nothing. What rode on the IMAGE stays on the image.
    expect(figure('<figure><p><img src="i.png" alt="a"></p><figcaption>cap</figcaption></figure>')).toEqual({
      type: 'image',
      src: 'i.png',
      alt: 'a',
    })
    expect(figure('<figure><img src="i.png" alt="a" class="z"><figcaption>cap</figcaption></figure>')).toEqual({
      type: 'image',
      src: 'i.png',
      alt: 'a',
      attrs: { classes: ['z'] },
    })
  })

  it('keeps the paragraph for every host that IS one', () => {
    // The other half of PART 11 §2's "only if": over-escaping and over-
    // unwrapping both pass every gate that only checks the shape it fixed.
    // Prose is not a caption host at all, and a paragraph holding more than the
    // image is not the image - both keep the wrapper, and the loss on those is
    // on the WRITING side, which is a different ticket's subject.
    const prose = figure('<figure><p>hello</p><figcaption>cap</figcaption></figure>') as { type: string }
    expect(prose.type).toBe('paragraph')
    const tail = figure('<figure><p><img src="i.png" alt="a"> tail</p><figcaption>cap</figcaption></figure>') as {
      type: string
    }
    expect(tail.type).toBe('paragraph')
    const two = figure(
      '<figure><img src="i.png" alt="a"><img src="j.png" alt="b"><figcaption>cap</figcaption></figure>',
    ) as { type: string }
    expect(two.type).toBe('paragraph')
  })

  it('keeps a <p> that carries its own attributes, because the tree is the exit that still holds them', () => {
    // The one shape where the WRAPPER is the faithful half: this tree renders
    // back to the input exactly, and the source moves the class onto a block-
    // attribute line that re-parses onto the figure. Unwrapping here would
    // delete `x` from the only exit that still records it.
    expect(figure('<figure><p class="x"><img src="i.png" alt="a"></p><figcaption>cap</figcaption></figure>')).toEqual({
      type: 'paragraph',
      children: [{ type: 'image', src: 'i.png', alt: 'a' }],
      attrs: { classes: ['x'] },
    })
  })
})
