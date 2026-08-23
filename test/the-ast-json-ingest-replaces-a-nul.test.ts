import { describe, it, expect } from 'vitest'
import {
  bbcodeToCarve,
  fromAstJson,
  parse,
  renderAnsi,
  renderCarve,
  renderHtml,
  renderMarkdown,
  renderPlainText,
  resolve,
} from '../src/index.js'

/**
 * PART 12 section 21: the AST-JSON ingest replaces every U+0000 with U+FFFD in
 * every string value, before it reads that value for anything else.
 *
 * `normalizeSource` has always done this to Carve source, which is why PART 9
 * section 29 carves the character out of the content class. The AST is a SECOND
 * DOOR into the same renderers and it had none, so an authored NUL and an
 * ingested one stood on different footings.
 *
 * THE DOOR IS NOT THE JSON PARSER. RFC 8259 forbids an unescaped U+0000 inside
 * a string, so a raw byte in JSON text is a `JSON.parse` syntax error before
 * any Carve rule is reached. What reaches the ingest is the escape, or a string
 * a host built in memory - `fromAstJson` takes a parsed OBJECT, so there is no
 * JSON layer there at all, and that is the door the clause exists for. Both are
 * exercised below.
 *
 * THE MEASURED DEFECT was data loss, not a theoretical collision.
 * `abbreviationPairKey` joins term and expansion on a NUL under the premise
 * that the parser strips the character from both halves - true of the parse
 * path, false of this one - so two distinct pairs keyed identically and one
 * occurrence of the first DELETED the second definition line (carve-js#1294).
 * That is the direction PART 11 section 10f's own comment says its two-pass
 * design exists to avoid.
 */

const NUL = '\u0000'
const FFFD = '\ufffd'
/**
 * A different C0 control, and the control for every row here. Section 29 still
 * makes U+000B ordinary content - the carve-out is U+0000 alone - so nothing
 * about this change may move it.
 */
const VT = '\u000b'

function textDoc(value: string): never {
  return {
    type: 'document',
    srcByteLength: 3,
    children: [{ type: 'paragraph', children: [{ type: 'text', value }] }],
  } as never
}

/** Two abbreviation pairs that collide on a NUL-joined key, plus one use. */
function abbrDoc(separator: string): never {
  return {
    type: 'document',
    srcByteLength: 40,
    children: [
      { type: 'abbreviation_def', abbr: `A${separator}b`, expansion: 'c' },
      { type: 'abbreviation_def', abbr: 'A', expansion: `b${separator}c` },
      {
        type: 'paragraph',
        children: [
          { type: 'abbreviation', abbr: `A${separator}b`, expansion: 'c' },
          { type: 'text', value: ' only.' },
        ],
      },
    ],
  } as never
}

const TARGETS = [
  ['html', renderHtml],
  ['markdown', renderMarkdown],
  ['plain', renderPlainText],
  ['ansi', renderAnsi],
  ['carve', renderCarve],
] as const

describe('the AST-JSON ingest replaces U+0000, as the parse boundary does', () => {
  it('keeps the definition line an ingested NUL used to delete', () => {
    // THE TICKET'S MEASUREMENT. Before the replacement this rendered
    // "A<NUL>b (c) only." and nothing else - the second definition line gone,
    // and the string "b<NUL>c" nowhere in the output.
    const rendered = renderPlainText(resolve(fromAstJson(abbrDoc(NUL))))

    expect(rendered).toBe(`*[A]: b${FFFD}c\n\nA${FFFD}b (c) only.\n`)
    expect(rendered).not.toContain(NUL)
  })

  it('renders the collision document as the same document with any other separator', () => {
    // The control that held on both sides: with a separator the parser does not
    // strip, the two pair keys already differed and the definition line
    // survived. The two outputs now differ only in the separator character.
    expect(renderPlainText(resolve(fromAstJson(abbrDoc(NUL))))).toBe(
      renderPlainText(resolve(fromAstJson(abbrDoc('Z')))).split('Z').join(FFFD),
    )
  })

  it('replaces the character on every target, through the in-memory door', () => {
    // Every target used to emit it verbatim except ANSI, which strips controls,
    // and the canonical writer, which DELETED it - so `fmt` was silently lossy
    // on a document that had one.
    for (const [name, render] of TARGETS) {
      const rendered = render(resolve(fromAstJson(textDoc(`a${NUL}b`))))

      expect(rendered, name).not.toContain(NUL)
      expect(rendered, name).toContain(`a${FFFD}b`)
    }
  })

  it('replaces the character behind the escape, through the JSON door', () => {
    // The only spelling JSON text can carry, and it decodes to the same value
    // the in-memory door hands over directly.
    const payload = JSON.stringify(textDoc(`a${NUL}b`))
    expect(payload).toContain('\\u0000')

    expect(renderHtml(resolve(fromAstJson(JSON.parse(payload))))).toBe(`<p>a${FFFD}b</p>`)
  })

  it('leaves a raw byte in JSON text a syntax error, which is RFC 8259 and not this clause', () => {
    // Section 21 does not relax the JSON grammar: the byte never reaches a Carve
    // rule. Stated as a row so a later reading of "replaces on ingest" cannot be
    // taken for "accepts a raw control byte in a JSON document".
    const raw = `{"type":"document","srcByteLength":3,"children":[{"type":"paragraph","children":[{"type":"text","value":"a${NUL}b"}]}]}`

    expect(() => JSON.parse(raw)).toThrow(SyntaxError)
  })

  it('replaces it in a string that is not a text value', () => {
    // "every string value it ingests", so an identifier, a class, an attribute
    // value and a code block's content are all in scope.
    const doc = {
      type: 'document',
      srcByteLength: 3,
      children: [
        {
          type: 'paragraph',
          attrs: {
            id: `i${NUL}d`,
            classes: [`c${NUL}k`],
            keyValues: { title: `x${NUL}y` },
            order: ['title'],
          },
          children: [{ type: 'text', value: 'q' }],
        },
        { type: 'code_block', lang: 'js', content: `a${NUL}b` },
      ],
    } as never

    const html = renderHtml(resolve(fromAstJson(doc)))

    expect(html).not.toContain(NUL)
    expect(html).toContain(`title="x${FFFD}y"`)
    expect(html).toContain(`class="c${FFFD}k"`)
    expect(html).toContain(`id="i${FFFD}d"`)
    expect(html).toContain(`a${FFFD}b`)
  })

  it('makes the ingested document agree with the same document written as source', () => {
    // The whole of the rule: the two doors into the renderers take the same
    // doormat, so what an author writes and what a host hands over land in the
    // same place.
    expect(renderHtml(resolve(fromAstJson(textDoc(`a${NUL}b`))))).toBe(
      renderHtml(resolve(parse(`a${NUL}b\n`))),
    )
  })

  it('writes source the parser reads back unchanged', () => {
    // The canonical writer deleted the byte, so `fmt` dropped a character with
    // no diagnostic. What it writes now survives a re-parse.
    const carve = renderCarve(resolve(fromAstJson(textDoc(`a${NUL}b`))))

    expect(renderPlainText(resolve(parse(carve)))).toBe(`a${FFFD}b\n`)
  })

  it('leaves the other C0 controls exactly where section 29 puts them', () => {
    // THE CONTROL THAT MUST NOT MOVE. The carve-out is U+0000 alone, so U+000B
    // stays ordinary content on html, markdown and plain, and stays stripped on
    // the terminal target where T4 strips the class.
    expect(renderHtml(resolve(fromAstJson(textDoc(`a${VT}b`))))).toBe(`<p>a${VT}b</p>`)
    expect(renderPlainText(resolve(fromAstJson(textDoc(`a${VT}b`))))).toBe(`a${VT}b\n`)
    expect(renderCarve(resolve(fromAstJson(textDoc(`a${VT}b`))))).toBe(`a${VT}b\n`)
    expect(renderAnsi(resolve(fromAstJson(textDoc(`a${VT}b`))))).not.toContain(VT)
  })

  it('leaves an authored U+FFFD and an ordinary document alone', () => {
    // The other two controls: the replacement character a payload already
    // carries is content, and a payload with no NUL in it comes back the same.
    expect(renderPlainText(resolve(fromAstJson(textDoc(`a${FFFD}b`))))).toBe(`a${FFFD}b\n`)
    expect(renderPlainText(resolve(fromAstJson(textDoc('ab'))))).toBe('ab\n')
  })

  it('refuses an unknown field without walking what hangs off it', () => {
    // WHERE THE PASS SITS, pinned. §21's readings - a sentinel, a key, a
    // renderer - all happen after the §12 refusals, and no refusal outcome
    // turns on this character, so the pass runs after them. Running it first
    // would descend into a field `refuseUnknownFields` throws at WITHOUT
    // descending into, turning a cheap refusal into a stack overflow on a
    // payload that names one over a deep nesting.
    let deep: unknown = { leaf: true }
    for (let i = 0; i < 200_000; i++) deep = { nested: deep }
    const doc = { type: 'document', srcByteLength: 0, children: [], x: deep } as never

    expect(() => fromAstJson(doc)).toThrow(/"x", which the schema does not name/)
  })

  it('refuses a type name spelled with a NUL as the unknown type it is', () => {
    // The other half of that ordering argument, and the reason it costs
    // nothing: a NUL in a type name is not a known type, and it is not one with
    // the NUL replaced either.
    const doc = {
      type: 'document',
      srcByteLength: 0,
      children: [{ type: `paragraph\u0000`, children: [] }],
    } as never

    expect(() => fromAstJson(doc)).toThrow(/paragraph/)
  })

  it('replaces it in the BBCode importer, which is the same boundary', () => {
    // Section 21 states the importer case as a SHOULD, since the format being
    // read may have its own rule; BBCode has none. The Markdown importer already
    // does this per CommonMark 2.3 (carve-js#1291), and this one passed the raw
    // byte through into its Carve output.
    expect(bbcodeToCarve(`a${NUL}b`)).toBe(`a${FFFD}b\n`)
    expect(bbcodeToCarve(`a${VT}b`)).toBe(`a${VT}b\n`)
    expect(bbcodeToCarve('[b]a[/b]')).toBe('*a*\n')
  })
})
