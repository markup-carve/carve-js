import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  carveToAstJson,
  carveToCarve,
  carveToHtml,
  carveToMarkdown,
  citations,
  parse,
} from '../src/index.js'
import type { CitationDefinition } from '../src/ast.js'

/*
 * PART 12 §18: a `[@key]: entry` bibliography line is a `citation_definition`.
 *
 * WHY EVERY ASSERTION HERE IS ON THE TREE.
 *
 * A definition renders nothing where it sits, so HTML cannot see this at all:
 * carve-php consumed the line at parse time and it was not in the tree, this
 * engine left it a paragraph whose first child is a `citation_group` followed
 * by the literal text `: {author=`, and both produced byte-identical HTML with
 * the same references list. Two engines published different documents for the
 * same source for as long as the feature has existed and every fixture agreed,
 * because no fixture was looking at the tree (markup-carve/carve#1276). A
 * rendered-output assertion is structurally incapable of catching it, which is
 * why the corpus check below asserts the OPPOSITE - that nothing moved.
 *
 * `parse` is the stage that matters, and it is the one the fix had to reach:
 * it is what `toAstJson` serializes and what §3a makes pre-resolve, while the
 * collect pass that used to recognize the line ran in the citations
 * extension's `afterParse` hook, which `parse` does not call. A fix living in
 * the hook would look right through the extension and wrong on the wire.
 */

const here = dirname(fileURLToPath(import.meta.url))

const DOC = `Smith [@smith2020] agree.

[@smith2020]: {author="Smith" year="2020"} Smith, J. (2020).
`

const withCitations = { extensions: [citations()] }

/** The definition nodes of a parsed document, typed. */
function definitions(source: string, opts: Record<string, unknown> = withCitations): CitationDefinition[] {
  return parse(source, opts).children.filter(
    (node): node is CitationDefinition => node.type === 'citation_definition',
  )
}

describe('a citation definition is a node at the parse stage', () => {
  it('is a citation_definition where a paragraph used to be', () => {
    const children = parse(DOC, withCitations).children
    expect(children.map((node) => node.type)).toEqual(['paragraph', 'citation_definition'])
  })

  it('carries the key without the at-sign, the entry as inline content, and the metadata block', () => {
    const [definition] = definitions(DOC)
    expect(definition!.key).toBe('smith2020')
    expect(definition!.attrs).toEqual({ keyValues: { author: 'Smith', year: '2020' } })
    expect(definition!.children.map((child) => child.type)).toEqual(['text'])
    expect(definition!.children[0]).toMatchObject({ type: 'text', value: 'Smith, J. (2020).' })
  })

  it('spans the whole line it was written on', () => {
    // The `pos` is the specific thing consuming the line at parse time threw
    // away, and without it the line cannot be reproduced: an AST round trip
    // deletes it. The span covers `[@key]` and the separator, not just the
    // entry - the node stands for the line the author wrote.
    const [definition] = definitions(DOC)
    expect(definition!.pos).toEqual({
      startLine: 3,
      endLine: 3,
      startColumn: 1,
      endColumn: 61,
      startOffset: 27,
      endOffset: 87,
    })
    // Independently of the numbers: the span has to select the source line.
    const line = DOC.slice(definition!.pos!.startOffset, definition!.pos!.endOffset)
    expect(line).toBe('[@smith2020]: {author="Smith" year="2020"} Smith, J. (2020).')
  })

  it('places the entry after the metadata block, not at the start of the line', () => {
    const [definition] = definitions(DOC)
    const entry = definition!.children[0]!
    expect(DOC.slice(entry.pos!.startOffset, entry.pos!.endOffset)).toBe('Smith, J. (2020).')
  })

  it('reaches the wire, which is the stage a fix in the afterParse hook would miss', () => {
    // `carveToAstJson` runs the hooks; `parse` does not. Both have to carry the
    // node, and it is `parse` that proves the recognition is not the hook's.
    const wire = carveToAstJson(DOC, withCitations)
    const definition = wire.children.find((node) => node.type === 'citation_definition')
    expect(definition).toBeDefined()
    expect(definition).toMatchObject({
      type: 'citation_definition',
      key: 'smith2020',
      attrs: { keyValues: { author: 'Smith', year: '2020' } },
    })
    expect(definition!.pos).toMatchObject({ startLine: 3, startColumn: 1 })
  })

  it('leaves none of the old shape behind', () => {
    // Stated as the absence it is, so a partial fix - a node built BESIDE the
    // paragraph rather than out of it - fails here rather than passing the
    // positive assertions above. The separator and the metadata block were
    // literal text in the published tree; neither may survive as text.
    const children = parse(DOC, withCitations).children
    const tree = JSON.stringify(children)
    expect(tree).not.toContain(': {author=')
    // One citation group left in the document: the use site in the prose. The
    // definition's own bracket became the node's `key`.
    expect(tree.split('"type":"citation_group"').length - 1).toBe(1)
  })
})

describe('the definitions a document can hold', () => {
  it('takes a definition with no metadata block', () => {
    const [definition] = definitions('[@a]: Plain entry.\n')
    expect(definition!.key).toBe('a')
    expect(definition!.attrs).toBeUndefined()
    expect(definition!.children[0]).toMatchObject({ type: 'text', value: 'Plain entry.' })
  })

  it('parses the entry as inline content, not as text', () => {
    const [definition] = definitions('[@a]: A *bold* and /ital/ entry.\n')
    expect(definition!.children.map((child) => child.type)).toEqual([
      'text',
      'strong',
      'text',
      'emphasis',
      'text',
    ])
  })

  it('gives two definitions on consecutive lines a node each', () => {
    // They are ONE paragraph in the source - soft-break separated - which is
    // exactly why the recognition splits a paragraph per line.
    const found = definitions('[@a]: First.\n[@b]: Second.\n')
    expect(found.map((definition) => definition.key)).toEqual(['a', 'b'])
    expect(found.map((definition) => definition.pos!.startLine)).toEqual([1, 2])
  })

  it('keeps the prose lines of a mixed paragraph in one paragraph', () => {
    // `a`/definition/`b` is one paragraph with the definition line taken out,
    // not two paragraphs: the HTML for it must not gain a paragraph break.
    const children = parse('Prose one\n[@a]: First.\nProse two\n', withCitations).children
    expect(children.map((node) => node.type)).toEqual(['paragraph', 'citation_definition'])
    expect(carveToHtml('Prose one\n[@a]: First.\nProse two\n', withCitations)).toBe(
      '<p>Prose one\nProse two</p>',
    )
    const paragraph = children[0]!
    expect(paragraph.pos).toMatchObject({ startLine: 1, endLine: 3 })
  })

  it('admits an empty entry, and the field with it', () => {
    // Which source lines carry no entry is a question §18 does not settle; the
    // FIELD is required and may be an empty array, so an engine cannot answer
    // it by dropping the field.
    const [definition] = definitions('[@a]: \n')
    expect(definition!.children).toEqual([])
  })
})

describe('the node is Tier-2 and top-level', () => {
  it('is not produced when the citations extension is off', () => {
    const children = parse('[@a]: Plain entry.\n').children
    expect(children.map((node) => node.type)).toEqual(['paragraph'])
  })

  it('is not produced inside a block quote or a list item', () => {
    // Measured behavior, recorded rather than ruled: §18 is about the node's
    // shape, and §7's answer - a definition inside a container is not one - is
    // what this engine gives. The line stays paragraph text and renders.
    expect(parse('> [@a]: First.\n', withCitations).children[0]!.type).toBe('block_quote')
    expect(carveToHtml('> [@a]: First.\n', withCitations)).toBe(
      '<blockquote><p>[@a]: First.</p></blockquote>',
    )
    expect(parse('- [@a]: First.\n', withCitations).children[0]!.type).toBe('list')
  })

  it('does not claim a line that is not a definition', () => {
    expect(definitions('Smith [@smith2020] agree.\n')).toEqual([])
    expect(definitions('[@a, p. 4]: Not a definition.\n')).toEqual([])
    expect(definitions('[see @a]: Not a definition.\n')).toEqual([])
    expect(definitions('[@a; @b]: Not a definition.\n')).toEqual([])
  })
})

describe('no rendered output moves', () => {
  const corpus = resolve(here, '../spec/tests/corpus-optional')

  for (const slug of ['05-citations-numbered', '06-citations-author-date']) {
    it(`${slug} renders its pinned HTML byte for byte`, () => {
      // The clause says the tree changes and the output does not, and this is
      // the document that carries three definition lines. It has to keep
      // producing the fixture it produced before they became nodes.
      const source = readFileSync(resolve(corpus, `${slug}.crv`), 'utf8')
      const expected = readFileSync(resolve(corpus, `${slug}.html`), 'utf8')
      const mode = slug.endsWith('author-date') ? ('author-date' as const) : ('numbered' as const)
      expect(carveToHtml(source, { extensions: [citations({ mode })] }).trim()).toBe(expected.trim())
    })
  }

  it('renders nothing where the definition sits, on every target', () => {
    expect(carveToHtml(DOC, withCitations)).toBe(
      '<p>Smith [<a data-cite-key="smith2020" href="#ref-smith2020">1</a>] agree.</p>\n' +
        '<ol class="references">\n' +
        '  <li id="ref-smith2020">Smith, J. (2020).</li>\n' +
        '</ol>',
    )
    expect(carveToMarkdown(DOC, withCitations)).toBe('Smith [@smith2020] agree.\n')
  })

  it('feeds author-date mode from the metadata block', () => {
    // The `{author= year=}` block moved from literal text into `attrs`, and the
    // extension reads it from there now. The label is the observable.
    const html = carveToHtml(DOC, { extensions: [citations({ mode: 'author-date' })] })
    expect(html).toContain('>Smith 2020</a>')
  })

  it('writes the line back, quoted, and reparses to the same HTML', () => {
    const formatted = carveToCarve(DOC, withCitations)
    expect(formatted).toBe(
      'Smith [@smith2020] agree.\n\n[@smith2020]: {author="Smith" year="2020"} Smith, J. (2020).\n',
    )
    // Quoted deliberately: `{author=Smith}` reparses as an attribute the
    // extension's quoted-value pattern does not read, so the formatter would
    // have emptied every author-date label.
    expect(carveToHtml(formatted, withCitations)).toBe(carveToHtml(DOC, withCitations))
    expect(carveToCarve(formatted, withCitations)).toBe(formatted)
  })

  it('keeps the entry inside the passes that walk a block for its inlines', () => {
    // The entry is rendered - in the references list - so the document-level
    // passes that resolve inline content have to reach it. They reached it as
    // a paragraph before; a walk keyed on block type drops it silently the
    // moment the line becomes its own type, and the reference then renders as
    // its own source text.
    const heading = carveToHtml('# Title\n\nSee [@a].\n\n[@a]: Entry [Title][] here.\n', withCitations)
    expect(heading).toContain('<a href="#Title">Title</a>')

    const footnote = carveToHtml('See [@a].\n\n[@a]: Entry.[^n]\n\n[^n]: Note.\n', withCitations)
    expect(footnote).toContain('<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a>')
  })

  it('keeps a run of definition lines a run, and a blank line a blank line', () => {
    expect(carveToCarve('[@a]: First.\n[@b]: Second.\n', withCitations)).toBe(
      '[@a]: First.\n[@b]: Second.\n',
    )
    expect(carveToCarve('[@a]: First.\n\n[@b]: Second.\n', withCitations)).toBe(
      '[@a]: First.\n\n[@b]: Second.\n',
    )
  })
})
