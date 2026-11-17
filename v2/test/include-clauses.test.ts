// Include expansion (spec/0.2/includes.md), in the order of the engine work list: each test names the clause it proves.
import { describe, expect, it } from 'vitest'
import {
  CarveOptionError, CarveRenderError, format, formatWithDiagnostics, parse, parseWithDiagnostics, parseWithLayout, render,
  renderWithDiagnostics, treesEqual, validateTree,
} from '../src/index.ts'
import { type IncludeNode, type Node } from '../src/ast.ts'
import { type IncludeRequest } from '../src/include-settings.ts'
import { includeExample, includes, virtualResolver, withoutPositions } from './support/includes.ts'

function codes(src: string, files: Readonly<Record<string, string | Uint8Array>>, more = {}): string[] {
  return renderWithDiagnostics(src, { includes: includes(files, more) }).diagnostics.map((entry) => entry.code)
}

function includeAt(src: string, files: Readonly<Record<string, string | Uint8Array>>, at = 0, more = {}): IncludeNode {
  const node = parse(src, { includes: includes(files, more), positions: false }).children[at]
  if (node?.type !== 'include') throw new Error('no include')
  return node
}

/** The child at `at` of the expected document of an example, the include node its stated tree shows. */
function expectedChild(example: { tree: unknown }, at = 0): unknown {
  return (example.tree as { children: unknown[] }).children[at]
}

describe('1. the tree contract', () => {
  it('C2-N-017, C2-A-181: an expanded include carries file and children, and a reader accepts it', () => {
    const document = parse('Top.\n\n{{ a.crv }}', { includes: includes({ 'a.crv': '---\nt: 1\n---\n\n[x]: /y\n\nA.\n' }) })
    validateTree(JSON.parse(JSON.stringify(document)))
    expect(document.children[1]).toMatchObject({ type: 'include', file: 'a.crv', children: [{ type: 'frontmatter' }, {}, {}] })
  })

  it('C2-N-017: a reader refuses children without file, and frontmatter that is not the first child', () => {
    const node = (children: unknown[], file?: string): unknown => ({
      type: 'document', astVersion: '2.0', children: [{ type: 'include', path: 'a', ...(file === undefined ? {} : { file }), children }],
    })
    expect(() => validateTree(node([]))).toThrow('an expanded include names its file')
    const frontmatter = { type: 'frontmatter', format: 'yaml', value: '' }
    expect(() => validateTree(node([{ type: 'thematic_break' }, frontmatter], 'a'))).toThrow('frontmatter is not the first child')
  })

  it('C2-A-171: the children of an include count their depth from level 0 again', () => {
    const deep = '> '.repeat(150)
    const document = parse(`${deep}{{ a }}`, { includes: includes({ a: `${deep}x\n` }) })
    expect(() => validateTree(JSON.parse(JSON.stringify(document)))).not.toThrow()
  })

  it('C2-N-081: tree equality skips children and file, so a parse with a resolver equals one without', () => {
    const src = 'Top.\n\n{{ a.crv }}'
    expect(treesEqual(parse(src, { includes: includes({ 'a.crv': 'A says hello.\n' }) }), parse(src))).toBe(true)
  })

  it('C2-N-006, C2-A-135: the stages name includeExpansion only where expansion ran', () => {
    expect(parse('x', { includes: includes({}) }).stages).toEqual(['includeExpansion', 'referenceResolution', 'tableAlignment'])
    expect(parse('x').stages).toEqual(['referenceResolution', 'tableAlignment'])
  })
})

describe('2. the option, the resolver interface and the path without a resolver', () => {
  it('C2-N-003, C2-H-133: without a resolver the directive is text, reported in the parse and the render channel', () => {
    const output = renderWithDiagnostics('{{ a.crv }}')
    expect(output.html).toBe('<p>{{ a.crv }}</p>')
    expect(output.diagnostics.map((entry) => [entry.code, entry.channel, entry.severity, entry.path])).toEqual([
      ['include-no-resolver', 'parse', 'warning', '/children/0'], ['include-unresolved', 'render-loss', 'warning', '/children/0'],
    ])
    expect(withoutPositions(parse('{{ a.crv }}').children[0]!)).toEqual({ type: 'include', path: 'a.crv' })
  })

  it('C2-N-007: the resolver gets the decoded path, the section, the valid options and the including file', () => {
    const calls: IncludeRequest[] = []
    const resolver = virtualResolver({ 'a b.crv': '{{ c.crv @lines:1-1 }}\n', 'c.crv': 'C\n' }, calls)
    render('{{ "a b.crv" #s @shift:1 @lines:9 }}\n\n{{ "a b.crv" @shift:-1 }}', { includes: { resolver, file: 'main.crv' } })
    expect(calls).toEqual([
      { path: 'a b.crv', options: { shift: -1 }, from: 'main.crv' },
      { path: 'c.crv', options: { lines: '1-1' }, from: 'a b.crv' },
    ])
    const top: IncludeRequest[] = []
    render('{{ x #s }}', { includes: { resolver: virtualResolver({ x: '{#s}\nY\n' }, top) } })
    expect(top).toEqual([{ path: 'x', section: 's', options: {} }])
  })

  it('C2-N-003, C2-N-064, C2-N-065: the option takes a resolver, or a resolver with the document id and lowered limits', () => {
    expect(() => parse('x', { includes: 'docs' })).toThrow(CarveOptionError)
    expect(() => parse('x', { includes: { resolver: 1 } })).toThrow('resolver is not a function')
    expect(() => parse('x', { includes: { resolver: () => ({ error: 'not_found' }), depth: 17 } })).toThrow('may be lowered and not raised')
    expect(() => parse('x', { includes: { resolver: () => ({ error: 'not_found' }), bytes: 8388609 } })).toThrow('may be lowered')
    expect(() => parse('x', { includes: { resolver: () => ({ error: 'not_found' }), root: '/' } })).toThrow('unknown field root')
    expect(render('{{ a }}', { includes: () => ({ text: 'A\n', id: 'a' }) })).toBe('<p>A</p>')
  })
})

describe('3. whole-file expansion', () => {
  it('C2-N-015: Example 2, an unclosed fence ends at the end of the child and is reported there', () => {
    const example = includeExample(2)
    expect(render(example.input, { includes: includes(example.files) })).toBe(example.html)
    const output = parseWithDiagnostics(example.input, { includes: includes(example.files) })
    expect(output.diagnostics.map((entry) => [entry.code, entry.path, entry.range])).toEqual([
      ['unclosed-code-fence', '/children/1/children/0', { startOffset: 0, endOffset: 16 }],
    ])
  })

  it('C2-N-016: a directive cannot complete or interrupt a construct of the including file', () => {
    expect(render('```\n{{ a }}\n```', { includes: includes({ a: 'x\n' }) })).toBe('<pre><code>{{ a }}\n</code></pre>')
    expect(render('Text\n{{ a }}', { includes: includes({ a: 'x\n' }) })).toBe('<p>Text\n{{ a }}</p>')
    expect(render('{{ a }}\nafter', { includes: includes({ a: '- one\n' }) })).toBe('<ul>\n  <li>one</li>\n</ul>\n<p>after</p>')
  })

  it('C2-N-017: an empty file gives an empty children list', () => {
    expect(includeAt('{{ a }}', { a: '' }).children).toEqual([])
    expect(render('{{ a }}', { includes: includes({ a: '' }) })).toBe('')
  })

  it('C2-N-019: Example 4, positions are local to the file and name it', () => {
    const example = includeExample(4)
    const node = parse(example.input, { includes: includes(example.files) }).children[1]
    expect(JSON.parse(JSON.stringify(node))).toEqual(expectedChild(example, 1))
  })

  it('C2-N-019: a nested node names its own file, and the include its including file', () => {
    const document = parse('{{ a }}', { includes: includes({ a: '{{ b }}\n', b: 'B\n' }) })
    const a = document.children[0] as IncludeNode
    const b = a.children![0] as IncludeNode
    expect(a.pos?.file).toBeUndefined()
    expect(b.pos?.file).toBe('a')
    expect(b.children![0]!.pos?.file).toBe('b')
  })
})

describe('4. the causes tested before the resolver', () => {
  it('C2-N-024, C2-N-062: Example 8, a conflict is reported, the resolver is not called and the node has no file', () => {
    const calls: IncludeRequest[] = []
    const output = renderWithDiagnostics('{{ a.crv #Intro @lines:1-2 }}', { includes: { resolver: virtualResolver({ 'a.crv': '= Intro\n' }, calls) } })
    expect(output.html).toBe('<p>{{ a.crv #Intro @lines:1-2 }}</p>')
    expect(output.diagnostics.map((entry) => entry.code)).toEqual(['include-selection-conflict', 'include-unresolved'])
    expect(calls).toEqual([])
    expect(includeAt('{{ a.crv #Intro @lines:1-2 }}', { 'a.crv': '' }).file).toBeUndefined()
  })

  it('C2-N-025: Example 9, an invalid option keeps the include unexpanded', () => {
    expect(codes('{{ a.crv @lines:5-2 }}', { 'a.crv': 'Whole file.\n' })).toEqual(['include-option-invalid', 'include-unresolved'])
    expect(includeAt('{{ a.crv @lines:5-2 }}', { 'a.crv': 'x' }).file).toBeUndefined()
  })

  it('C2-N-024: each row of conflicts', () => {
    const file = { 't.csv': 'a,b\n1,2\n' }
    expect(codes('{{ t.csv @rows:1-2 }}', file)[0]).toBe('include-selection-conflict')
    expect(codes('{{ t.csv @cols:1-2 @code:csv }}', file)[0]).toBe('include-selection-conflict')
    expect(codes('{{ t.csv #s @code }}', file)[0]).toBe('include-selection-conflict')
    expect(codes('{{ t.csv @lines:1-1 @region:r }}', file)[0]).toBe('include-selection-conflict')
    expect(codes('{table}\n{{ t.csv @rows:1-2 @lines:1-1 @code:csv }}', file)[0]).toBe('include-selection-conflict')
    expect(codes('{table}\n{{ t.csv @rows:2-2 @cols:"b" @code:csv }}', file)).toEqual([])
  })

  it('C2-N-061: the first cause that applies is the one reported', () => {
    expect(codes('{{ a @shift:x @lines:1-1 @region:r }}', {})).toEqual(['include-option-invalid', 'include-unresolved'])
  })
})

describe('5. limits and cycles', () => {
  it('C2-N-064: Example 23, with the depth lowered to 1 the include in a.crv is not resolved', () => {
    const example = includeExample(23)
    const document = parse(example.input, { includes: includes(example.files, { depth: 1 }), positions: false })
    const a = document.children[0] as IncludeNode
    expect(a.file).toBe('a.crv')
    expect(a.children![0]).toEqual({ type: 'include', path: 'b.crv' })
    expect(codes(example.input, example.files, { depth: 1 })).toEqual(['include-depth', 'include-unresolved'])
  })

  it('C2-N-064: depth 16 is the limit, and the seventeenth file is refused', () => {
    const files: Record<string, string> = {}
    for (let at = 0; at < 17; at++) files[`f${at}`] = `{{ f${at + 1} }}\n`
    files['f17'] = 'deep\n'
    const output = renderWithDiagnostics('{{ f0 }}', { includes: includes(files) })
    expect(output.html).toBe('<p>{{ f16 }}</p>')
    expect(output.diagnostics.map((entry) => entry.code)).toEqual(['include-depth', 'include-unresolved'])
    expect(output.diagnostics[0]!.message).toBe('Include "f16" was not expanded: it is nested deeper than 16 levels.')
  })

  it('C2-N-066: Example 24, a cycle is refused and the inner include keeps file and no children', () => {
    const example = includeExample(24)
    const document = parse(example.input, { includes: includes(example.files), positions: false })
    const b = ((document.children[0] as IncludeNode).children![1] as IncludeNode).children![0]
    expect(b).toEqual({ type: 'include', path: 'a.crv', file: 'a.crv' })
    expect(codes(example.input, example.files)).toEqual(['include-cycle', 'include-unresolved'])
  })

  it('C2-N-066: a file that returns the id of the top-level document is a cycle', () => {
    const output = renderWithDiagnostics('{{ self }}', { includes: { ...includes({ self: 'x\n' }), file: 'self' } })
    expect(output.diagnostics.map((entry) => entry.code)).toEqual(['include-cycle', 'include-unresolved'])
  })

  it('C2-N-065: a text past the cap is refused, keeps file, and does not count toward the sum', () => {
    expect(withoutPositions(includeAt('{{ a }}', { a: 'too large' }, 0, { bytes: 8 }))).toEqual({ type: 'include', path: 'a', file: 'a' })
    const calls: IncludeRequest[] = []
    const resolver = virtualResolver({ a: 'too large', b: '1234' }, calls)
    const twice = renderWithDiagnostics('{{ a }}\n\n{{ a }}', { includes: { resolver, bytes: 8 } })
    expect(twice.diagnostics.map((entry) => entry.code)).toEqual(['include-budget', 'include-budget', 'include-unresolved', 'include-unresolved'])
    expect(calls.length).toBe(2)
  })

  it('C2-N-065: once the sum has reached the cap, a later include is refused before its resolver', () => {
    const calls: IncludeRequest[] = []
    const document = parse('{{ b }}\n\n{{ b }}\n\n{{ a }}', { includes: { resolver: virtualResolver({ a: 'too large', b: '1234' }, calls), bytes: 8 } })
    expect(calls.map((call) => call.path)).toEqual(['b', 'b'])
    expect((document.children[2] as IncludeNode).file).toBeUndefined()
    const output = renderWithDiagnostics('{{ b }}\n\n{{ b }}\n\n{{ a }}', { includes: { ...includes({ a: 'x', b: '1234' }), bytes: 8 } })
    expect(output.diagnostics[0]!.message).toBe('Include "a" was not expanded: the included texts reach the size cap of 8 bytes.')
  })
})

describe('6. the causes the resolver returns', () => {
  it('C2-N-068: Example 25, include-not-found names the path as written', () => {
    const output = renderWithDiagnostics('{{ missing.crv #part @shift:1 }}', { includes: includes({}) })
    expect(output.html).toBe('<p>{{ missing.crv #part @shift:1 }}</p>')
    expect(output.diagnostics.map((entry) => [entry.code, entry.message])).toEqual([
      ['include-not-found', 'Include "missing.crv" was not expanded: the file does not exist.'],
      ['include-unresolved', 'Include "missing.crv" could not be resolved.'],
    ])
  })

  it('C2-N-011: bytes that are not text, or text with U+0000, are non_text and leave no file', () => {
    expect(codes('{{ bin }}', { bin: new Uint8Array([0x61, 0x00, 0x62]) })).toEqual(['include-non-text', 'include-unresolved'])
    expect(codes('{{ bin }}', { bin: new Uint8Array([0xff, 0xfe]) })).toEqual(['include-non-text', 'include-unresolved'])
    expect(codes('{{ s }}', { s: 'a\ud800' })).toEqual(['include-non-text', 'include-unresolved'])
    expect(includeAt('{{ bin }}', { bin: new Uint8Array([0x61, 0x00]) }).file).toBeUndefined()
    expect(render('{{ u }}', { includes: includes({ u: new TextEncoder().encode('﻿é\n') }) })).toBe('<p>é</p>')
  })

  it('C2-N-013, C2-N-068: a resolver that throws is unreadable, and its text appears in no message', () => {
    const resolver = (): never => { throw new Error('/home/secret/path') }
    const output = renderWithDiagnostics('{{ a }}', { includes: { resolver } })
    expect(output.diagnostics.map((entry) => entry.code)).toEqual(['include-unreadable', 'include-unresolved'])
    expect(JSON.stringify(output)).not.toContain('secret')
  })

  it('C2-N-007: each error cause gives its code; an answer of another shape is unreadable', () => {
    for (const [error, code] of [['outside_root', 'include-outside-root'], ['unreadable', 'include-unreadable'], ['non_text', 'include-non-text']]) {
      const output = renderWithDiagnostics('{{ a }}', { includes: () => ({ error }) })
      expect(output.diagnostics[0]!.code).toBe(code)
    }
    expect(renderWithDiagnostics('{{ a }}', { includes: () => 'x' as never }).diagnostics[0]!.code).toBe('include-unreadable')
  })
})

describe('7. rendering an expanded include', () => {
  it('C2-N-075: an expanded include writes no element, attribute or source line of its own', () => {
    expect(render('{#i .c}\n{{ a }}', { includes: includes({ a: 'x\n' }), sourceLines: true })).toBe('<p data-source-line="1">x</p>')
  })

  it('C2-N-075: the bare first paragraph of a description reads through the include', () => {
    expect(render(': term\n\n  {{ a }}', { includes: includes({ a: 'Def\n' }) })).toBe(render(': term\n\n  Def'))
  })

  it('C2-N-078: under strictLosses an unexpanded include throws, an expanded one does not', () => {
    expect(() => render('{{ a }}', { strictLosses: true, includes: includes({}) })).toThrow(CarveRenderError)
    expect(render('{{ a }}', { strictLosses: true, includes: includes({ a: 'x\n' }) })).toBe('<p>x</p>')
  })

  it('C2-N-079: under roundtrip an outermost expanded include is reported once', () => {
    const example = includeExample(3)
    const output = renderWithDiagnostics(example.input, { roundtrip: true, includes: includes(example.files) })
    expect(output.html).toBe(example.html)
    expect(output.diagnostics.map((entry) => [entry.code, entry.channel])).toEqual([['include-expanded-roundtrip', 'render-loss']])
    const nested = renderWithDiagnostics('{{ a }}', { roundtrip: true, includes: includes({ a: '{{ b }}\n', b: 'x\n' }) })
    expect(nested.diagnostics.map((entry) => entry.code)).toEqual(['include-expanded-roundtrip'])
  })

  it('C2-N-079: the abbreviation template covers the definitions of the document only', () => {
    const html = render('{{ a }}\n\n*[B]: Bee', { roundtrip: true, includes: includes({ a: 'A B\n\n*[A]: Ay\n' }) })
    expect(html).toContain('<template data-carve-abbreviations>*[B]: Bee</template>')
    expect(html).not.toContain('*[A]')
  })

  it('C2-N-077: Example 30, under comment the include degrades, expanded or not, and is reported once', () => {
    const output = renderWithDiagnostics('{{ a.crv }}', { profile: 'comment', includes: includes({ 'a.crv': 'Included *text*.\n' }) })
    expect(output.html).toBe('<p>{{ a.crv }}</p>')
    expect(output.diagnostics.map((entry) => entry.code)).toEqual(['profile-construct-degraded'])
  })
})

describe('8. writer, fmt and the Carve target', () => {
  it('C2-N-005, C2-N-080: fmt writes the directive, never the children, and reports nothing for them', () => {
    expect(format('Top.\n\n{{ a.crv }}')).toBe('Top.\n\n{{ a.crv }}\n')
    expect(format('{.c}\n{{ a.crv @code }}\n^ cap')).toBe('{.c}\n{{ a.crv @code }}\n^ cap\n')
  })

  it('C2-N-005: the formatter reports no include-no-resolver', () => {
    expect(formatWithDiagnostics('{{ a.crv }}')).toEqual({ source: '{{ a.crv }}\n', diagnostics: [] })
  })

  it('C2-N-080: the writer writes an expanded tree as its directives', async () => {
    const { write } = await import('../src/index.ts')
    const document = parse('Top.\n\n{{ a.crv }}', { includes: includes({ 'a.crv': 'A says hello.\n' }) })
    expect(write(document)).toBe('Top.\n\n{{ a.crv }}\n')
  })

  it('C2-N-082: the layout record has entries for the top-level blocks only', () => {
    const result = parseWithLayout('Top.\n\n{{ a.crv }}', { includes: includes({ 'a.crv': 'A.\n\nB.\n' }) })
    expect(result.layout.nodes.map((entry) => entry.path)).toEqual(['/children/0', '/children/1'])
  })
})

describe('9. frontmatter and abbreviations of included files', () => {
  it('C2-N-021: Example 5, the frontmatter is the first child and no metadata of the document', () => {
    const example = includeExample(5)
    expect(withoutPositions(includeAt(example.input, example.files, 1))).toEqual(withoutPositions(expectedChild(example, 1)))
  })

  it('C2-N-023: Example 7, the parent term applies in the child and the child term wins', () => {
    const example = includeExample(7)
    expect(render(example.input, { includes: includes(example.files) })).toBe(example.html)
  })

  it('C2-N-023: a term the child defines does not reach the parent', () => {
    expect(render('CSS\n\n{{ a }}', { includes: includes({ a: '*[CSS]: Sheets\n' }) })).toBe('<p>CSS</p>')
  })
})

describe('10. references across files', () => {
  it('C2-N-054: a definition of the child does not reach the parent', () => {
    expect(render('[x][]\n\n{{ a }}', { includes: includes({ a: '[x]: /child\n' }) })).toBe('<p>[x][]</p>')
  })

  it('C2-N-055: a footnote only the child defines is unresolved in the parent', () => {
    expect(render('See [^c].\n\n{{ a }}', { includes: includes({ a: '[^c]: Child.\n' }) })).toBe('<p>See [^c].</p>')
  })

  it('C2-N-060: a key two files each define once reports nothing; twice in one file is a duplicate', () => {
    expect(codes('[x]: /a\n\n{{ a }}', { a: '[x]: /b\n' })).toEqual([])
    expect(codes('{{ a }}', { a: '[x]: /b\n[x]: /c\n' })).toEqual(['duplicate-link-reference-definition'])
  })

  it('C2-N-058: a duplicate id across files is reported at the later occurrence', () => {
    const example = includeExample(22)
    const output = parseWithDiagnostics(example.input, { includes: includes(example.files) })
    expect(output.diagnostics.map((entry) => [entry.code, entry.path])).toEqual([['duplicate-id', '/children/1/children/0']])
  })

  it('C2-N-059: caption numbers count over the expanded tree', () => {
    const html = render('{{ a }}\n\n| x |\n^ Table #: two', { includes: includes({ a: '| y |\n^ Table #: one\n' }) })
    expect(html).toContain('Table 1: one')
    expect(html).toContain('Table 2: two')
  })
})

describe('11. section', () => {
  it('C2-N-031: Example 12, the tree holds the selected block and then the definitions the selection did not take', () => {
    const example = includeExample(12)
    const node = includeAt(example.input, example.files)
    expect(node.children!.map((child) => child.type)).toEqual(['paragraph', 'link_reference_definition'])
    expect(node.children![1]).toMatchObject({ key: 's' })
  })

  it('C2-N-030: Example 11, a section that selects nothing keeps file and is reported', () => {
    const example = includeExample(11)
    expect(includeAt(example.input, example.files).file).toBe('a.crv')
    expect(codes(example.input, example.files)).toEqual(['include-section', 'include-unresolved'])
  })

  it('C2-N-027: a section matches with case, and a generated id of the file alone', () => {
    expect(render('{{ a #intro }}', { includes: includes({ a: '= Intro\n' }) })).toBe('<p>{{ a #intro }}</p>')
    expect(render('{{ a #Intro }}', { includes: includes({ a: '= Intro\n' }) })).toBe('<section id="Intro">\n  <h1>Intro</h1>\n</section>')
  })

  it('C2-N-028: a heading inside a container is bounded by it; a block id selects the block alone', () => {
    expect(render('{{ a #h }}', { includes: includes({ a: '> {#h}\n> = H\n>\n> in\n\nout\n' }) }))
      .toBe('<section id="h">\n  <h1>H</h1>\n  <p>in</p>\n</section>')
    expect(render('{{ a #p }}', { includes: includes({ a: 'skip\n\n{#p .c}\npick\n\nskip\n' }) })).toBe('<p id="p" class="c">pick</p>')
  })

  it('C2-N-029: an id on a list item selects nothing', () => {
    expect(codes('{{ a #i }}', { a: '- {#i} item\n' })[0]).toBe('include-section')
  })

  it('C2-N-033: the nested includes of a section expand after selection, and only those inside it', () => {
    const calls: IncludeRequest[] = []
    render('{{ a #s }}', { includes: { resolver: virtualResolver({ a: '{{ out }}\n\n{#s}\n= S\n\n{{ in }}\n', in: 'In.\n', out: 'Out.\n' }, calls) } })
    expect(calls.map((call) => call.path)).toEqual(['a', 'in'])
  })
})

describe('12. lines and region', () => {
  it('C2-N-020, C2-N-036: Example 13, a slice that cuts a fence; positions start at line 3 of the file', () => {
    const example = includeExample(13)
    const document = parse(example.input, { includes: includes(example.files) })
    const code = (document.children[0] as IncludeNode).children![0]!
    expect(code.pos).toEqual({ startLine: 3, endLine: 4, startColumn: 1, endColumn: 4, startOffset: 5, endOffset: 12, file: 'a.crv' })
  })

  it('C2-N-035: a range that starts past the last line keeps file; one that ends past it is clipped', () => {
    expect(codes('{{ a.crv @lines:9-9 }}', { 'a.crv': 'one\ntwo\n' })).toEqual(['include-lines-out-of-range', 'include-unresolved'])
    expect(includeAt('{{ a.crv @lines:9-9 }}', { 'a.crv': 'one\ntwo\n' }).file).toBe('a.crv')
    expect(render('{{ a @lines:2-9 }}', { includes: includes({ a: 'one\n\ntwo\n' }) })).toBe('<p>two</p>')
  })

  it('C2-N-034: an empty file and one that holds only U+FEFF have no lines', () => {
    expect(codes('{{ a @lines:1-1 }}', { a: '﻿' })[0]).toBe('include-lines-out-of-range')
    expect(codes('{{ a @lines:1-1 }}', { a: '' })[0]).toBe('include-lines-out-of-range')
  })

  it('C2-N-038: a // region marker in a Carve include is text, so the region is not found', () => {
    expect(codes('{{ a @region:x }}', { a: '// #region x\nKept.\n// #endregion\n' })).toEqual(['include-region-invalid', 'include-unresolved'])
  })

  it('C2-N-041: a repeated, unclosed or mismatched marker leaves the include unexpanded and keeps file', () => {
    const marks = ['%% #region x\n%% #endregion\n%% #region x\n%% #endregion\n', '%% #region x\n', '%% #region x\n%% #endregion y\n']
    for (const text of marks) expect(codes('{{ a @region:x }}', { a: text })[0], text).toBe('include-region-invalid')
    expect(includeAt('{{ a @region:x }}', { a: '%% #region x\n' }).file).toBe('a')
  })

  it('C2-N-037: an empty region selects an empty source; another region inside stays source', () => {
    expect(includeAt('{{ a @region:x }}', { a: '%% #region x\n%% #endregion x\n' }).children).toEqual([])
    expect(render('{{ a @region:x }}', { includes: includes({ a: '%% #region x\n%% #region y\nY\n%% #endregion\n%% #endregion\n' }) }))
      .toBe('<p>Y</p>')
  })
})

describe('13. code mode, attributes, captions and tables', () => {
  it('C2-N-042: Example 15, the tree of a region read as js with the attributes copied to the child', () => {
    const example = includeExample(15)
    expect(withoutPositions(includeAt(example.input, example.files))).toEqual(withoutPositions(expectedChild(example)))
  })

  it('C2-N-043: the payload of a file and two blank lines is the same with and without a line range', () => {
    const value = (src: string): unknown => (includeAt(src, { 't.txt': 'x\n\n\n' }).children![0] as { value: string }).value
    expect(value('{{ t.txt @code }}')).toBe('x\n\n\n')
    expect(value('{{ t.txt @lines:1-3 @code }}')).toBe('x\n\n\n')
  })

  it('C2-N-042: the payload is not read as Carve, and a directive in it is never expanded', () => {
    const calls: IncludeRequest[] = []
    const html = render('{{ a @code }}', { includes: { resolver: virtualResolver({ a: '{{ b }}\n*x*\n```\n', b: 'B' }, calls) } })
    expect(html).toBe('<pre><code>{{ b }}\n*x*\n```\n</code></pre>')
    expect(calls.length).toBe(1)
  })

  it('C2-N-045, C2-B-181: malformed quoting under {table} gives a table and the delimited-table finding', () => {
    const output = renderWithDiagnostics('{table}\n{{ d.csv @code:csv }}', { includes: includes({ 'd.csv': 'a,b\n"open,x\n' }) })
    expect(output.html).toContain('<table>')
    expect(output.diagnostics.map((entry) => entry.code)).toEqual(['delimited-table-malformed'])
  })

  it('C2-N-046, C2-N-047: rows and cols on the data of Example 16', () => {
    const example = includeExample(16)
    const html = render('{table}\n{{ data/plans.csv @rows:2-3 @cols:"Seats,Plan" @code:csv }}', { includes: includes(example.files) })
    expect(html).toBe([
      '<table>', '  <thead>', '    <tr><th scope="col">Seats</th><th scope="col">Plan</th></tr>', '  </thead>', '  <tbody>',
      '    <tr><td>1</td><td>Starter</td></tr>', '    <tr><td>10</td><td>Team</td></tr>', '  </tbody>', '</table>',
    ].join('\n'))
  })

  it('C2-N-046, C2-N-047: the record and column failures in their test order', () => {
    const files = { 'p.csv': 'Plan,Seats\nA,1\n' }
    expect(codes('{table}\n{{ p.csv @rows:9-9 @code:csv }}', files)[0]).toBe('include-rows-out-of-range')
    expect(codes('{table}\n{{ p.csv @cols:"Nope" @code:csv }}', files)[0]).toBe('include-cols-invalid')
    expect(codes('{table}\n{{ p.csv @cols:"Plan,Plan" @code:csv }}', files)[0]).toBe('include-cols-duplicate')
    expect(codes('{table}\n{{ p.csv @cols:1-2 @code:csv }}', files)[0]).toBe('include-cols-invalid')
    expect(codes('{table header-rows=0}\n{{ p.csv @cols:1-3 @code:csv }}', files)[0]).toBe('include-cols-invalid')
    expect(render('{table header-rows=0}\n{{ p.csv @cols:2-2 @code:csv }}', { includes: includes(files) }))
      .toBe('<table>\n  <tbody>\n    <tr><td>Seats</td></tr>\n    <tr><td>1</td></tr>\n  </tbody>\n</table>')
  })

  it('C2-N-046: a whole line that is a well-formed marker is no record', () => {
    const html = render('{table}\n{{ p.csv @code:csv }}', { includes: includes({ 'p.csv': 'h\n#region x\nv\n// #endregion\n' }) })
    expect(html).toBe('<table>\n  <thead>\n    <tr><th scope="col">h</th></tr>\n  </thead>\n  <tbody>\n    <tr><td>v</td></tr>\n  </tbody>\n</table>')
  })

  it('C2-N-046: a marker line inside a quoted field is data of that field, also for region', () => {
    const file = 'Name\n"first\n#region keep\nmid\n#endregion keep\nlast"\n'
    const cell = 'first\n#region keep\nmid\n#endregion keep\nlast'
    expect(render('{table}\n{{ a.csv @code:csv }}', { includes: includes({ 'a.csv': file }) })).toContain(`<td>${cell}</td>`)
    expect(codes('{table}\n{{ a.csv @region:keep @code:csv }}', { 'a.csv': file })[0]).toBe('include-region-invalid')
    const outer = render('{table}\n{{ a.csv @region:r @code:csv }}', { includes: includes({ 'a.csv': `#region r\n${file}#endregion r\n` }) })
    expect(outer).toContain(`<td>${cell}</td>`)
  })

  it('C2-N-046: the foot is the last footer-rows records of the file under rows, lines and region', () => {
    const t = { 't.csv': 'H\na\nb\nF\n' }
    const html = (selection: string): string => render(`{table footer-rows=1}\n{{ t.csv ${selection} @code:csv }}`, { includes: includes(t) })
    const table = (body: string[]): string => [
      '<table>', '  <thead>', '    <tr><th scope="col">H</th></tr>', '  </thead>', '  <tbody>', ...body.map((cell) => `    <tr><td>${cell}</td></tr>`),
      '  </tbody>', '  <tfoot>', '    <tr><td>F</td></tr>', '  </tfoot>', '</table>',
    ].join('\n')
    expect(html('@rows:2-4')).toBe(table(['a', 'b']))
    expect(html('@rows:1-2')).toBe(table(['a']))
    expect(html('@lines:3-4')).toBe(table(['b']))
    const regioned = { 't.csv': 'H\na\n#region r\nb\n#endregion\nF\n' }
    expect(render('{table footer-rows=1}\n{{ t.csv @region:r @code:csv }}', { includes: includes(regioned) })).toBe(table(['b']))
  })

  it('C2-N-046, C2-B-221: the head takes its records first, and a larger footer-rows takes all records below it', () => {
    const html = render('{table header-rows=2 footer-rows=5}\n{{ t.csv @rows:1-3 @code:csv }}', { includes: includes({ 't.csv': 'H\nI\nF\n' }) })
    expect(html).toBe([
      '<table>', '  <thead>', '    <tr><th scope="col">H</th></tr>', '    <tr><th scope="col">I</th></tr>', '  </thead>',
      '  <tfoot>', '    <tr><td>F</td></tr>', '  </tfoot>', '</table>',
    ].join('\n'))
  })

  it('C2-N-047: cols names match the head of the whole file under lines and region', () => {
    const file = { 'a.csv': 'Name,Price\nA,1\n%% #region r\nB,2\n%% #endregion\n' }
    const html = (selection: string): string => render(`{table}\n{{ a.csv ${selection} @cols:"Price" @code:csv }}`, { includes: includes(file) })
    const table = (cell: string): string =>
      `<table>\n  <thead>\n    <tr><th scope="col">Price</th></tr>\n  </thead>\n  <tbody>\n    <tr><td>${cell}</td></tr>\n  </tbody>\n</table>`
    expect(html('@lines:2-2')).toBe(table('1'))
    expect(html('@region:r')).toBe(table('2'))
  })

  it('C2-N-021: with code the frontmatter lines of the file are content of the payload', () => {
    const files = { 'a.md': '---\nt: 1\n---\nbody\n' }
    expect(render('{{ a.md @code }}', { includes: includes(files) })).toBe('<pre><code>---\nt: 1\n---\nbody\n</code></pre>')
    expect(includeAt('{{ a.md }}', files).children?.[0]).toMatchObject({ type: 'frontmatter', value: 't: 1\n' })
  })

  it('C2-N-073: the caption of an expanded code include is captioned as an authored code block, notes included', () => {
    const files = { 'a.txt': 'code\n' }
    const authored = render('```\ncode\n```\n^ Listing #: x^[note]')
    expect(render('{{ a.txt @code }}\n^ Listing #: x^[note]', { includes: includes(files) })).toBe(authored)
    const html = render('{{ a.txt @code }}\n^ Listing #: x[^n]\n\n[^n]: N', { includes: includes(files) })
    expect(html).toContain('<figcaption>Listing 1: x<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></figcaption>')
  })

  it('C2-N-073, C2-N-074: the caption of an unexpanded code include is numbered and written after the directive', () => {
    expect(render('{{ x.js @code }}\n^ Listing #: Code', { includes: includes({}) })).toBe('<p>{{ x.js @code }}</p>\n<p>Listing 1: Code</p>')
  })

  it('C2-N-073: a caption below an include without code is text', () => {
    expect(render('{{ a }}\n^ cap', { includes: includes({ a: 'x\n' }) })).toBe('<p>x</p>\n<p>^ cap</p>')
  })

  it('C2-N-072: an include\'s own id is no anchor and no duplicate; the child of a code include carries it', () => {
    expect(codes('{#a}\n{{ x }}\n\n{#a}\nP', { x: 'X\n' })).toEqual([])
    expect(render('{#a}\n{{ x @code }}', { includes: includes({ x: 'X\n' }) })).toBe('<pre id="a"><code>X\n</code></pre>')
  })

  it('C2-N-044: a code child starts after the U+FEFF of line 1, and an empty file has a zero-width span there', () => {
    const pos = (text: string): unknown => includeAt('{{ a @code }}', { a: text }, 0).children![0]
    const document = parse('{{ a @code }}', { includes: includes({ a: '﻿ab\n' }) })
    expect((document.children[0] as IncludeNode).children![0]!.pos).toEqual({
      startLine: 1, endLine: 1, startColumn: 1, endColumn: 3, startOffset: 3, endOffset: 5, file: 'a',
    })
    const empty = parse('{{ a @code }}', { includes: includes({ a: '﻿' }) })
    expect((empty.children[0] as IncludeNode).children![0]).toMatchObject({ value: '', pos: { startOffset: 3, endOffset: 3 } })
    expect(pos('')).toMatchObject({ value: '' })
  })
})

describe('14. shift', () => {
  it('C2-N-048: Example 17, a shifted heading past 6 is clamped and reported', () => {
    const example = includeExample(17)
    expect(codes(example.input, example.files)).toEqual(['include-heading-clamp'])
  })

  it('C2-N-049: a nested auto is placed against the assembled levels', () => {
    const html = render('= One\n\n== Two\n\n{{ child @shift:auto }}', { includes: includes({ child: '{{ grand }}\n', grand: '= GrandTop\n\n== GrandSub\n' }) })
    expect(html).toContain('<h3>GrandTop</h3>')
    expect(html).toContain('<h4>GrandSub</h4>')
  })

  it('C2-N-049: a heading in a sibling container that closed does not count; an earlier include does', () => {
    const levels = (src: string, files: Record<string, string>): number[] => {
      const found: number[] = []
      const walk = (nodes: readonly Node[]): void => {
        for (const node of nodes) {
          if (node.type === 'heading') found.push(node.level)
          if ('children' in node && Array.isArray(node.children)) walk(node.children as Node[])
        }
      }
      walk(parse(src, { includes: includes(files) }).children)
      return found
    }
    expect(levels('> == In\n\n{{ c @shift:auto }}', { c: '= C\n' })).toEqual([2, 1])
    expect(levels('{{ a }}\n\n{{ c @shift:auto }}', { a: '=== A\n', c: '= C\n' })).toEqual([3, 4])
  })

  it('C2-N-048: an include inside a footnote body is shifted too', () => {
    const html = render('a[^n]\n\n[^n]: {{ c @shift:2 }}', { includes: includes({ c: '= Deep\n' }) })
    expect(html).toContain('<h3 id="Deep">Deep</h3>')
  })

  it('C2-N-051: shift on a code include has no effect and reports nothing', () => {
    expect(codes('{{ a @shift:3 @code }}', { a: '= x\n' })).toEqual([])
  })
})

describe('16. dependencies', () => {
  it('C2-N-083: Example 31, four include nodes in tree order with their including files', async () => {
    const { includeDependencies } = await import('../src/index.ts')
    const example = includeExample(31)
    expect(render(example.input, { includes: includes(example.files) })).toBe(example.html)
    expect(includeDependencies(parse(example.input, { includes: includes(example.files) }))).toEqual([
      { path: 'a.crv', file: 'a.crv', read: true },
      { path: 'b.crv', from: 'a.crv', file: 'b.crv', read: true },
      { path: 'gone.crv', from: 'a.crv', read: false },
      { path: 'b.crv', file: 'b.crv', read: true },
    ])
  })

  it('C2-N-083: with no resolver every directive is a dependency that was not read', async () => {
    const { includeDependencies } = await import('../src/index.ts')
    expect(includeDependencies(parse('{{ a }}\n\n> {{ b }}'))).toEqual([{ path: 'a', read: false }, { path: 'b', read: false }])
  })
})
