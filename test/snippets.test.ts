// Named snippets beyond the clause cases: the marker parts and the carriers a document transform keeps.
import { describe, expect, it } from 'vitest'
import { CarveTreeError, decodeTree, type DocumentNode, type ExtensionDefinition, format, parse, parseTree, render, renderTree, renderWithDiagnostics, renderWithDocumentTransforms, resolveTree, writeWithDiagnostics } from '../src/index.ts'
import { withSnippetLimits } from '../src/harness-limits.ts'
import { lint } from '../lint/lint.ts'

describe('named snippets', () => {
  it('C2-A-220, C2-A-221, C2-B-236: a reader refuses a snippet name outside the name syntax', () => {
    const tree = (name: string): string => JSON.stringify({ astVersion: '2.0', type: 'document', children: [
      { type: 'snippet_definition', name: 'a', children: [{ type: 'snippet_use', mode: 'inline', name }] },
    ] })
    expect(() => decodeTree(tree('2.0'))).toThrow(CarveTreeError)
    expect(() => decodeTree(tree('-a'))).toThrow('/children/0/children/0/name: not a snippet name')
    expect(() => decodeTree(tree('_a-1'))).not.toThrow()
  })

  it('C2-A-027, C2-A-221: a reader refuses the common fields the schema withholds from a snippet use', () => {
    const tree = (fields: Record<string, unknown>): string => JSON.stringify({ astVersion: '2.0', type: 'document', children: [
      { type: 'snippet_definition', name: 's', children: [{ type: 'text', value: 'hi' }] },
      { type: 'paragraph', children: [{ type: 'snippet_use', mode: 'inline', name: 's', ...fields }] },
    ] })
    for (const [field, value] of [['lang', '2.0'], ['lang', 'en'], ['dir', 'ltr'], ['metadata', {}], ['attrs', { id: 'x' }]] as const) {
      expect(() => decodeTree(tree({ [field]: value }))).toThrow(`/children/1/children/0/${field}: not a field of snippet_use`)
    }
    const pos = { startLine: 1, endLine: 1, startColumn: 1, endColumn: 2, startOffset: 0, endOffset: 1 }
    expect(() => decodeTree(tree({}))).not.toThrow()
    expect(() => decodeTree(tree({ pos, segments: [pos] }))).not.toThrow()
  })

  it('carve#6896: a parsed block use that took an attribute line reads back until that line is decided', () => {
    for (const source of ['{$v}: X\n{k}\n{{ $v }}', '{$v}: X\n\n{.k :en}\n{{ $v }}', '{$v}: X\n\n> {#a}\n> {{ $v }}']) {
      const tree = parseTree(source)
      expect(() => decodeTree(JSON.stringify(tree.document), source)).not.toThrow()
      const children = (text: string): unknown => parseTree(text, { positions: false }).document.children
      expect(children(format(source))).toEqual(children(source))
    }
  })

  it('C2-B-236: a glued block after a quoted value holding } still reads', () => {
    const definition = parseTree('{$x title="a}b"}{.foo}: Hi', { positions: false }).document.children[0]
    expect(definition?.attrs).toEqual({ classes: ['foo'], keyValues: [['title', 'a}b']] })
  })

  it('C2-B-095, C2-B-236: the attribute lines come first, then the marker parts and its glued blocks', () => {
    const definition = parseTree('{.a}\n{.b k=1}\n{$x .c}{.d k=2}: Hi', { positions: false }).document.children[0]
    expect(definition?.type).toBe('snippet_definition')
    expect(definition?.attrs).toEqual({ classes: ['a', 'b', 'c', 'd'], keyValues: [['k', '2']] })
  })

  it('C2-B-236: an id key in an attribute line above the marker makes the line text, with the marker reported', () => {
    const src = '{.a}\n{id=i}\n{$x}: Hi\n'
    expect(parseTree(src, { positions: false }).document.children.map((child) => child.type)).toEqual(['paragraph'])
    expect(lint(src).filter((d) => d.code === 'snippet-definition-id').map((d) => d.range)).toEqual([{ startOffset: 12, endOffset: 17 }])
  })

  it('C2-B-236: a comment line between the attribute lines holds no id, and an id above it still refuses the marker', () => {
    const kept = parseTree('{.a}\n%% {#z}\n{.b}\n{$x}: Hi\n', { positions: false }).document.children
    expect(kept.map((child) => child.type)).toEqual(['comment', 'snippet_definition'])
    expect(kept[1]?.attrs).toEqual({ classes: ['a', 'b'] })
    const src = '{#z}\n%% c\n{.a}\n{$x}: Hi\n'
    expect(lint(src).filter((d) => d.code === 'snippet-definition-id').map((d) => d.range)).toEqual([{ startOffset: 15, endOffset: 20 }])
  })

  it('C2-H-215: a document transform that changes the view keeps the carriers of the uses', () => {
    const result = renderWithDocumentTransforms('{$x}: Hello\n\n{{ $x }}\n', [{ name: 'append', transform: (view) => {
      view.children.push({ type: 'paragraph', children: [{ type: 'text', value: 'end' }] })
      return view
    } }], { roundtrip: true })
    expect(result.html).toContain('<p data-carve-snippet="1:block:$x">Hello</p>')
    expect(result.html).toContain('<p>end</p>')
  })

  it('C2-N-090: the definitions of an include inside a container join the registry', () => {
    const includes = ({ path }: { path: string }) => path === 'a.crv' ? { text: '{$v}: X\n', id: path } : { error: 'not_found' as const }
    const result = renderWithDiagnostics('- {{ a.crv }}\n\n{{ $v }}\n', { includes })
    expect(result.html).toContain('<p>X</p>')
    expect(result.diagnostics).toEqual([])
  })

  it('C2-H-215: a copy that renders as one link carries the carriers on its a, and a span where it writes none', () => {
    expect(render('{$v}: [x](/u)\n\nA {{ $v }}\n', { roundtrip: true })).toContain('<a href="/u" data-carve-snippet="1:inline:$v">x</a>')
    expect(render('{$v}: [x][k]\n\nA {{ $v }}\n', { roundtrip: true })).toContain('<span data-carve-snippet="1:inline:$v">[x][k]</span>')
  })

  it('C2-N-091: the staged API expands on its own copy and leaves the parsed tree its uses', () => {
    const parsed = parseTree('{$x}: Hello\n\n{{ $x }}\n')
    expect(renderTree(resolveTree(parsed))).toBe('<p>Hello</p>')
    expect(parsed.document.children.map((node) => node.type)).toEqual(['snippet_definition', 'snippet_use'])
  })

  it('C2-N-095: an authored definition with no use is no transform finding, a resolved reference in it neither', () => {
    const append = [{ name: 'append', transform: (view: DocumentNode) => {
      view.children.push({ type: 'paragraph', children: [{ type: 'text', value: 'end' }] })
      return view
    } }]
    for (const source of ['{$x}: Hello\n\nA\n', '{$x}: [l][k]\n\n[k]: /u\n\n{{ $x }}\n']) {
      expect(renderWithDocumentTransforms(source, append, { strictLosses: true }).diagnostics).toEqual([])
    }
  })

  it('C2-H-215: a lone link inside link text puts the carriers on a span, and an abbreviation in a definition writes as text', () => {
    const result = renderWithDiagnostics('*[A]: Long\n\n{$x}: [A](/inner)\n\n[{{ $x }}](/outer)\n', { roundtrip: true })
    expect(result.html).toContain('<span data-carve-snippet="1:inline:$x"><abbr title="Long">A</abbr></span>')
    expect(result.html).toContain('<template data-carve-snippets>{$x}: [A](/inner)</template>')
    expect(result.diagnostics).toEqual([])
  })

  it('C2-H-115, C2-H-215: authored snippet carriers are dropped, and a moved inline note carries its mark', () => {
    const authored = renderWithDiagnostics('{data-carve-snippet="1:inline:$z"}\nP\n', { roundtrip: true })
    expect(authored.html).toBe('<p>P</p>')
    expect(authored.diagnostics.map((entry) => entry.code)).toEqual(['carrier-attribute-dropped'])
    expect(render('{$s}: x^[note]\n\n[Go {{ $s }}](/u)\n', { roundtrip: true })).toContain('data-carve-snippet-mark="1"')
  })

  it('C2-N-094: a key of a key-value attribute counts with its value', () => {
    // Two nodes, 64, and `text`, `X`, `paragraph`, `foo` and `v`, 18: 82 bytes.
    const source = '{$x foo=v}: X\n\n{{ $x }}\n'
    expect(withSnippetLimits({ derivedTextBytes: 82 }, () => render(source))).toBe('<p foo="v">X</p>')
    const refused = withSnippetLimits({ derivedTextBytes: 81 }, () => renderWithDiagnostics(source))
    expect(refused.diagnostics.map((entry) => entry.code)).toEqual(['derived-text-budget'])
  })

  it('C2-N-092: a copy used before a nested include resolves in the scopes of the includes around its file', () => {
    const files: Record<string, string> = { 'a.crv': '[k]: /from-a\n\n{{ b.crv }}\n', 'b.crv': '{$s}: [x][k]\n' }
    const includes = ({ path }: { path: string }) => Object.hasOwn(files, path) ? { text: files[path]!, id: path } : { error: 'not_found' as const }
    expect(render('{{ $s }}\n\n{{ a.crv }}\n', { includes })).toBe('<p><a href="/from-a">x</a></p>')
  })

  it('C2-N-092, C2-N-093: a node in the metadata of a copy is copied without its position and counted', () => {
    const pos = { startLine: 1, endLine: 1, startColumn: 1, endColumn: 2, startOffset: 0, endOffset: 1 }
    const tree = { type: 'document', astVersion: '2.0', children: [
      { type: 'snippet_definition', name: 'x', children: [
        { type: 'span', metadata: { title: [{ type: 'text', value: 'T', pos }] }, children: [{ type: 'text', value: 'X' }] }] },
      { type: 'paragraph', children: [{ type: 'snippet_use', name: 'x', mode: 'inline' }] }] } as unknown as DocumentNode
    expect(JSON.stringify(resolveTree(tree).document.children[1])).not.toContain('"pos"')
    expect(withSnippetLimits({ snippetNodes: 2 }, () => renderTree(resolveTree(tree)))).toBe('<p>{{ $x }}</p>')
    expect(withSnippetLimits({ snippetNodes: 3 }, () => renderTree(resolveTree(tree)))).toBe('<p><span>X</span></p>')
  })

  it('C2-N-093: a refused use keeps its finding through a document transform, a new root keeping the budget', () => {
    const noop = [{ name: 'noop', transform: (view: DocumentNode) => view }]
    const fresh = [{ name: 'fresh', transform: (view: DocumentNode) => ({ ...view, children: [...view.children] }) }]
    for (const transforms of [noop, fresh]) {
      const result = renderWithDocumentTransforms('A {{ $missing }}\n', transforms)
      expect(result.diagnostics.map((entry) => entry.code)).toEqual(['snippet-unresolved'])
    }
  })

  it('C2-W-159: a break inside an inline container of a supplied definition is written as a space', () => {
    const tree = { type: 'document', astVersion: '2.0', children: [{ type: 'snippet_definition', name: 'x', children: [
      { type: 'emphasis', children: [{ type: 'text', value: 'a' }, { type: 'soft_break' }, { type: 'text', value: 'b' }] }] }] }
    const written = writeWithDiagnostics(tree as unknown as DocumentNode)
    expect(written.source).toBe('{$x}: /a b/\n')
    expect(parse(written.source).children).toHaveLength(1)
  })

  it('C2-N-096: a definition of an included file that the including file uses is no unused snippet', () => {
    const files: Record<string, string> = { 'child.crv': '{$x}: X\n\n{$y}: Y\n' }
    const resolver = ({ path }: { path: string }) => Object.hasOwn(files, path) ? { text: files[path]!, id: path } : { error: 'not_found' as const }
    const found = lint('{{ child.crv }}\n\n{{ $x }}\n', { includes: { resolver } })
    expect(found.filter((entry) => entry.code === 'unused-snippet').map((entry) => entry.message)).toEqual(['Snippet "$y" is defined but never used.'])
  })

  it('C2-N-095: a transform that edits an authored definition adds no snippet node', () => {
    const edit = [{ name: 'edit', transform: (view: DocumentNode) => {
      const definition = view.children[0]
      if (definition?.type === 'snippet_definition') definition.children = [{ type: 'text', value: 'Changed' }]
      view.children.push({ type: 'paragraph', children: [{ type: 'text', value: 'end' }] })
      return view
    } }]
    expect(renderWithDocumentTransforms('{$x}: Hello\n\nA\n', edit, { strictLosses: true }).diagnostics).toEqual([])
    const add = [{ name: 'add', transform: (view: DocumentNode) => {
      view.children.push({ type: 'snippet_definition', name: 'y', children: [{ type: 'text', value: 'Y' }] })
      return view
    } }]
    expect(renderWithDocumentTransforms('{$x}: Hello\n\nA\n', add).diagnostics.map((entry) => entry.code))
      .toEqual(['snippet-unexpanded-transform'])
  })

  it('C2-N-092: each copy has attribute arrays of its own', () => {
    const resolved = resolveTree(parseTree('{$x .a}: Hi\n\n{{ $x }}\n\n{{ $x }}\n'))
    const [, first, second] = resolved.document.children
    first!.attrs!.classes!.push('b')
    expect(second!.attrs!.classes).toEqual(['a'])
  })

  it('C2-H-215: a link that holds a use is no lone element, so the carriers go on a span', () => {
    const html = render('{$n}: x[^f]\n\n{$l}: [a {{ $n }}](/u)\n\nB {{ $l }}\n\n[^f]: F\n', { roundtrip: true })
    expect(html).toContain('<span data-carve-snippet="1:inline:$l"><a href="/u">')
  })

  it('C2-H-215: an autolink copy and a link whose use brings no note carry the carriers on their a', () => {
    expect(render('{$v}: <https://example.com>\n\nA {{ $v }}\n', { roundtrip: true }))
      .toContain('<p>A <a href="https://example.com" data-carve-autolink data-carve-snippet="1:inline:$v">https://example.com</a></p>')
    expect(render('{$b}: text\n\n{$a}: [{{ $b }}](/url)\n\nA {{ $a }}\n', { roundtrip: true }))
      .toContain('<p>A <a href="/url" data-carve-snippet="1:inline:$a"><span data-carve-snippet="2:inline:$b">text</span></a></p>')
    expect(render('{$v}: <https://example.com>\n\n[A {{ $v }}](/x)\n', { roundtrip: true }))
      .toContain('<a href="/x">A <span data-carve-snippet="1:inline:$v">https://example.com</span></a>')
  })

  it('C2-H-215: the carriers survive the attribute copy of a link with rel or a definition with attributes', () => {
    expect(render('{$v}: [t](/u){rel=nofollow}\n\nA {{ $v }}\n', { roundtrip: true }))
      .toContain('<a href="/u" rel="nofollow" data-carve-snippet="1:inline:$v">t</a>')
    expect(render('{$v}: [t][r]\n\n[r]: /u {.c}\n\nA {{ $v }}\n', { roundtrip: true }))
      .toContain('<a href="/u" data-carve-ref="r" class="c" data-carve-snippet="1:inline:$v">t</a>')
    expect(render('{$v}: [x]{abbr="why"}\n\nA {{ $v }}\n', { roundtrip: true }))
      .toContain('<abbr title="why" data-carve-snippet="1:inline:$v">x</abbr>')
  })

  it('C2-N-090, C2-N-096: across files the losing definition reports duplicate-snippet and no unused hint', () => {
    const files: Record<string, string> = { 'c.crv': '{$x}: B\n' }
    const resolver = ({ path }: { path: string }) => Object.hasOwn(files, path) ? { text: files[path]!, id: path } : { error: 'not_found' as const }
    const found = lint('{$x}: A\n\n{{ c.crv }}\n', { includes: { resolver } }).map((entry) => [entry.code, entry.file])
    expect(found).toEqual([['unused-snippet', undefined], ['duplicate-snippet', 'c.crv']])
  })

  it('C2-N-020: a section include does not lint past its section for an appended definition', () => {
    const files: Record<string, string> = { 's.crv': '# Pick\n\nP\n\n# Else\n\n> {$v}:x\n\n{$w}: W\n' }
    const resolver = ({ path }: { path: string }) => Object.hasOwn(files, path) ? { text: files[path]!, id: path } : { error: 'not_found' as const }
    expect(lint('{{ s.crv#Pick }}\n', { includes: { resolver } }).filter((entry) => entry.file === 's.crv')).toEqual([])
  })

  it('C2-N-095: a definition a transform adds enters no registry, so it reports no duplicate', () => {
    const add = [{ name: 'add', transform: (view: DocumentNode) => {
      view.children.push({ type: 'snippet_definition', name: 'x', children: [{ type: 'text', value: 'Y' }] })
      return view
    } }]
    expect(renderWithDocumentTransforms('{$x}: Hello\n\nA\n', add).diagnostics.map((entry) => entry.code))
      .toEqual(['snippet-unexpanded-transform'])
  })

  it('C2-N-095: a definition an include brings is the transforms\' own input, no finding', () => {
    const resolver = ({ path }: { path: string }) => path === 'd.crv' ? { text: '{$x}: Hi\n', id: path } : { error: 'not_found' as const }
    const add = [{ name: 'add', transform: (view: DocumentNode) => {
      view.children.push({ type: 'paragraph', children: [{ type: 'text', value: 'e' }] })
      return view
    } }]
    const result = renderWithDocumentTransforms('{{ d.crv }}\n', add, { includes: resolver, strictLosses: true })
    expect([result.html, result.diagnostics]).toEqual(['<p>e</p>', []])
  })

  it('C2-N-096: a file included twice keeps the unused hint of its winning definition', () => {
    const resolver = ({ path }: { path: string }) => path === 'c.crv' ? { text: '{$x}: X\n', id: path } : { error: 'not_found' as const }
    const found = lint('{{ c.crv }}\n\n{{ c.crv }}\n', { includes: { resolver } }).map((entry) => entry.code)
    expect(found.sort()).toEqual(['duplicate-snippet', 'unused-snippet'])
  })

  it('C2-W-159: a break in a ruby base of a supplied definition is written as a space', () => {
    const tree = { type: 'document', astVersion: '2.0', children: [{ type: 'snippet_definition', name: 'x', children: [{ type: 'ruby',
      pairs: [{ type: 'ruby_pair', base: [{ type: 'text', value: 'a' }, { type: 'soft_break' }, { type: 'text', value: 'b' }],
        annotation: [{ type: 'text', value: 'c' }] }] }] }] }
    const written = writeWithDiagnostics(tree as unknown as DocumentNode)
    expect(written.source.split('\n')).toHaveLength(2)
    expect(parse(written.source).children).toHaveLength(1)
  })

  it('C2-N-092: after a transform a copy still resolves in the scopes of the includes around its file', () => {
    const files: Record<string, string> = { 'a.crv': '[k]: /from-a\n\n{{ b.crv }}\n', 'b.crv': '{$s}: [x][k]\n' }
    const includes = ({ path }: { path: string }) => Object.hasOwn(files, path) ? { text: files[path]!, id: path } : { error: 'not_found' as const }
    const add = [{ name: 'add', transform: (view: DocumentNode) => {
      view.children.push({ type: 'paragraph', children: [{ type: 'text', value: 'e' }] })
      return view
    } }]
    expect(renderWithDocumentTransforms('{{ a.crv }}\n\n{{ $s }}\n', add, { includes }).html).toBe('<p><a href="/from-a">x</a></p>\n<p>e</p>')
  })

  it('the staged path keeps the parse facts of a document that defines a snippet and uses none', () => {
    const source = '{$x}: hi\n\n{#x}\n```js\nx\n```\n^ cap\n'
    const staged = renderTree(resolveTree(parseTree(source), { sourceLines: true }))
    expect(staged).toBe(render(source, { sourceLines: true }))
    expect(staged).toContain('data-source-line="4"')
  })

  it('a document with an include and no snippet renders as it did, with and without a snippet in the include', () => {
    const files: Record<string, string> = { 'a.crv': 'A *b*\n', 's.crv': '{$x}: Hi\n' }
    const resolver = ({ path }: { path: string }) => Object.hasOwn(files, path) ? { text: files[path]!, id: path } : { error: 'not_found' as const }
    expect(render('See {{ a.crv }} here.\n\n{{ a.crv }}\n', { includes: { resolver } })).toBe('<p>See {{ a.crv }} here.</p>\n<p>A <strong>b</strong></p>')
    expect(render('{{ s.crv }}\n\nSay {{ $x }}.\n', { includes: { resolver } })).toBe('<p>Say Hi.</p>')
  })

  it('a line selection without snippet syntax keeps the snippet definitions it appends from its file', () => {
    const files: Record<string, string> = { 'd.crv': 'Hello\n\n{$x}: A\n\n{$x}: B\n' }
    const resolver = ({ path }: { path: string }) => Object.hasOwn(files, path) ? { text: files[path]!, id: path } : { error: 'not_found' as const }
    const out = renderWithDiagnostics('{{ d.crv @lines:1-1 }}\n', { includes: { resolver } })
    expect(out.html).toBe('<p>Hello</p>')
    expect(out.diagnostics.map((entry) => entry.code)).toEqual(['duplicate-snippet'])
    expect(render('{{ d.crv @lines:1-1 }}\n\nSay {{ $x }}.\n', { includes: { resolver } })).toBe('<p>Hello</p>\n<p>Say A.</p>')
  })

  it('the parse facts count a snippet use that an extension transform returns', () => {
    const extension: ExtensionDefinition = { name: 'test.box', version: '1', matcher: { form: 'div', name: 'box' }, props: {}, slots: {},
      transform: (claim) => claim.form === 'div' ? { type: 'block_extension', name: 'test.box', version: '1', children: [],
        fallback: [{ type: 'paragraph', children: [{ type: 'snippet_use', name: 'x', mode: 'inline' }] }] } : null }
    const facts = parseTree('::: box\nx\n:::\n', { extensions: [extension] }).facts
    expect([facts?.snippets, facts?.snippetUses]).toEqual([true, true])
    expect([parseTree('::: box\nx\n:::\n').facts?.snippets, parseTree('{$x}: A\n').facts?.snippetUses]).toEqual([false, false])
  })

  it('C2-B-236, C2-W-090: format escapes paragraph text that would read back as a snippet definition', () => {
    for (const marker of ['{$v}', '{$v .c}', '{$v}{.c}', '{$v .c}{.d}', '{$v key="a b"}']) {
      const src = `\\${marker}: X\n`
      expect(format(src)).toBe(src)
      expect(format(`a\n\n${src}`)).toBe(`a\n\n${src}`)
      expect(format(`{.k}\n${src}`)).toBe(`{.k}\n${src}`)
    }
  })

  it('C2-B-236, C2-W-090: a line that opens no definition keeps its brace bare', () => {
    for (const src of ['{$v}:x\n', '{$v #i}: X\n', '{#k}\n{$v}: X\n', '> {$v}: X\n', '- {$v}: X\n', '::: d\n{$v}: X\n:::\n', 'a\n{$v}: X\n']) {
      expect(format(src)).toBe(src)
    }
  })

  it('C2-W-140, C2-W-146: the pair rules read the value of a definition, and fmt escapes its pairs', () => {
    const src = '{$v}: _e_ ~s~\n\n{{ $v }}\n'
    expect(lint(src, { upgrade: true }).map((d) => d.code)).toEqual(['deprecated-bare-underline', 'deprecated-bare-strike'])
    expect(format(src)).toBe('{$v}: \\_e_ \\~s~\n\n{{ $v }}\n')
  })
})
