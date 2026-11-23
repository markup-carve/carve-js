import { describe, expect, it } from 'vitest'
import { parse, parseWithDiagnostics, render } from '../src/api.ts'
import { flatten } from '../src/flatten.ts'
import { format } from '../src/format.ts'
import { write, writeWithDiagnostics } from '../src/write.ts'
import { lint } from '../lint/lint.ts'
import { corpusResolver } from '../scripts/corpus.ts'
import { type DocumentNode } from '../src/ast.ts'
import { LINEARITY_LIMIT, linearityExcess } from './support/linearity.ts'

describe('typed metadata blocks, C2-B-231 to C2-W-153', () => {
  it('reads a column-zero typed opener after a list without a blank line as a lazy line (carve#6389)', () => {
    const source = '- a\n---yaml\nk: v\n---\n'
    expect(parse(source).children.map((node) => node.type)).toEqual(['list'])
    expect(render(source)).toBe('<ul>\n  <li>a\n—yaml\nk: v\n—</li>\n</ul>')
  })

  it('C2-W-154: writes the paragraph directly below a list that ends in a block without lazy lines (carve#6394)', () => {
    const lists = ['- ```\n  x\n  ```', '- :::\n  x\n  :::', '- | a | b |', '- = H', '- a\n  - ```\n    x\n    ```', '- ***',
      '- > ```\n  > x\n  > ```', '- > = H', '- ::: >\n  q\n  :::', '- ::: |\n  a\n  :::',
      '- %%%\n  hi\n  %%%', '- {{ foo }}', '- %% c', '- ```\n  x\n  ```\n  %% c']
    for (const list of lists) {
      const source = `${list}\n---yaml\nk: v\n---\n`
      expect(format(source)).toBe(source)
    }
  })

  it('C2-W-154: keeps the blank line where the first line is no typed opener', () => {
    expect(format('- = H\n---yaml *x*\n')).toBe('- = H\n\n---yaml *x*\n')
  })

  it('C2-W-155: indents a list that ends in a block with lazy lines by one space (carve#6398)', () => {
    const tree = parse('- ```\n  x\n  ```\n---yaml\nk: v\n---\n')
    const [list, paragraph] = tree.children
    const quoted = parse('- > q\n').children[0]!
    const result = writeWithDiagnostics({ ...tree, children: [quoted, paragraph!] })
    expect(list?.type).toBe('list')
    expect(result.source).toBe(' - > q\n\n ---yaml\nk: v\n---\n')
    expect(result.diagnostics).toEqual([])
  })

  it('C2-W-154: writes the paragraph directly below a footnote or description that ends in a closed block (carve#6397)', () => {
    const containers = ['a[^n]\n\n[^n]: x\n\n  ```\n  y\n  ```', '[^n]: ::: d\n  y\n  :::', 'a[^n]\n\n[^n]: x\n\n  - = H',
      ':: t\n: ```\n  y\n  ```', ':: t\n: u\n:: v\n: | a | b |', ':: t\n: > ```\n  > y\n  > ```', ':: t\n: %% c']
    for (const container of containers) {
      const source = `${container}\n---yaml\nk: v\n---\n`
      expect(format(source)).toBe(source)
    }
  })

  it('C2-W-154: refuses the paragraph below a footnote that ends in a block with lazy lines', () => {
    const tree = parse('a[^n]\n\n[^n]: x\n\n{.c}\n ---yaml\nk: v\n---\n')
    const [reference, footnote, attributed] = tree.children
    const { attrs, ...paragraph } = attributed!
    expect(attrs).toBeDefined()
    const result = writeWithDiagnostics({ ...tree, children: [reference!, footnote!, paragraph] })
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(['structure-unspellable'])
  })

  it('C2-W-155: indents a description list that ends in a block with lazy lines by one space (carve#6409)', () => {
    const tree = parse('a\n\n{.c}\n ---yaml\nk: v\n---\n')
    const { attrs, ...paragraph } = tree.children[1]!
    expect(attrs).toBeDefined()
    const description = parse(':: t\n: > q\n').children[0]!
    const result = writeWithDiagnostics({ ...tree, children: [description, paragraph] })
    expect(result.source).toBe(' :: t\n : > q\n\n ---yaml\nk: v\n---\n')
    expect(result.diagnostics).toEqual([])
  })

  it('C2-W-154: indents the first line of a top-level paragraph that would read as a typed opener', () => {
    for (const source of ['a\n\n ---yaml\nk: v\n---\n', ' ---yaml\nk: v\n---\n', '- a\n\n{.c}\n ---yaml\nk: v\n---\n',
      'a[^n]\n\n[^n]: x\n\n{.c}\n ---yaml\nk: v\n---\n']) {
      const result = writeWithDiagnostics(parse(source))
      expect(result.source).toBe(source)
      expect(result.diagnostics).toEqual([])
    }
  })

  it('C2-B-232: opens a metadata block at column 0 after a description list and a blank line (carve-js#5392)', () => {
    for (const container of [':: t\n: d', ':: u\n: > e', ':: t\n: ```\n  k\n  ```', '{.c}\n:: t\n: d']) {
      const children = parse(`${container}\n\n---yaml\nk: v\n---\n`).children
      expect(children.map((node) => node.type), container).toEqual(['definition_list', 'frontmatter'])
      expect(children[1]).toMatchObject({ format: 'yaml', value: 'k: v\n' })
    }
    expect(render(':: t\n: d\n\n---yaml\nk: v\n---\n')).toBe('<dl>\n  <dt>t</dt>\n  <dd>d</dd>\n</dl>')
  })

  it('C2-W-155: below a list, description list or footnote, departs in order or refuses (carve#6418)', () => {
    const paragraph = parse('a\n\n ---yaml\nk: v\n---\n').children[1]!
    const spelled = [
      ['a[^n]\n\n[^n]: x\n\n{.c}\n- b\n', 'a[^n]\n\n[^n]: x\n\n{.c}\n - b\n\n ---yaml\nk: v\n---\n'],
      [':: t\n: d\n\n- b\n', ' :: t\n : d\n\n - b\n\n ---yaml\nk: v\n---\n'],
      [':: t\n: d\n\n{start=3}\n3. b\n', ':: t\n: d\n\n{start=3}\n . b\n\n ---yaml\nk: v\n---\n'],
      ['1. x\n\n:: t\n: d\n\n- b\n  c\n', ' . x\n\n :: t\n : d\n\n - b\n   c\n\n ---yaml\nk: v\n---\n'],
    ]
    for (const [above, expected] of spelled) {
      const tree = parse(above!)
      const result = writeWithDiagnostics({ ...tree, children: [...tree.children, paragraph] })
      expect(result.source, above).toBe(expected)
      expect(result.diagnostics).toEqual([])
    }
    for (const above of ['a[^n]\n\n[^n]: x\n\n- b\n', 'a[^n]\n\n[^n]: x\n\n:: t\n: d\n\n- b\n']) {
      const tree = parse(above)
      const result = writeWithDiagnostics({ ...tree, children: [...tree.children, paragraph] })
      expect(result.diagnostics.map((entry) => [entry.code, entry.path]), above)
        .toEqual([['structure-unspellable', `/children/${tree.children.length}`]])
    }
  })

  it('C2-W-155: writes the refused paragraph one space in so it reads back as no metadata block (carve#6441)', () => {
    const paragraph = parse('a\n\n ---yaml\nk: v\n---\n').children[1]!
    const cases = [
      ['a[^n]\n\n[^n]: x\n\n- b\n', 'a[^n]\n\n[^n]: x\n\n- b\n\n ---yaml\nk: v\n---\n'],
      ['a[^n]\n\n[^n]: x\n\n:: u\n: e\n', 'a[^n]\n\n[^n]: x\n\n:: u\n: e\n\n ---yaml\nk: v\n---\n'],
      ['a[^n]\n\n[^n]: x\n\n:: t\n: d\n\n- b\n', 'a[^n]\n\n[^n]: x\n\n:: t\n: d\n\n- b\n\n ---yaml\nk: v\n---\n'],
      ['a[^n]\n\n[^n]: x\n', 'a[^n]\n\n[^n]: x\n\n ---yaml\nk: v\n---\n'],
    ]
    for (const [above, expected] of cases) {
      const tree = parse(above!)
      const result = writeWithDiagnostics({ ...tree, children: [...tree.children, paragraph] })
      expect(result.source, above).toBe(expected)
      expect(result.diagnostics.map((entry) => [entry.code, entry.path]), above)
        .toEqual([['structure-unspellable', `/children/${tree.children.length}`]])
      expect(parse(result.source).children.map((node) => node.type), above).not.toContain('frontmatter')
    }
  })

  it('C2-W-155: walks a long run of lists below a footnote in linear time (carve#6418)', () => {
    const paragraph = parse('a\n\n ---yaml\nk: v\n---\n').children[1]!
    const tree = (lists: number): DocumentNode => {
      const document = parse(`a[^n]\n\n[^n]: x\n\n${':: t\n: d\n\n* x\n\n'.repeat(lists / 2)}`)
      return { ...document, children: [...document.children, paragraph] }
    }
    const small = tree(250)
    const large = tree(2000)
    expect(linearityExcess(() => writeWithDiagnostics(small), () => writeWithDiagnostics(large), 8)).toBeLessThan(LINEARITY_LIMIT)
  })

  it('takes a top-level key after a list and keeps the block outside that list', () => {
    const children = parse('- a\n\n{#m}\n---yaml\nk: v\n---\n').children
    expect(children.map((node) => node.type)).toEqual(['list', 'frontmatter'])
    expect(children[1]?.attrs?.id).toBe('m')
  })

  it('ignores a later block for document version but reports a metadata cross-reference', () => {
    const source = 'a\n\n{#m}\n---yaml\ncarve: 9.9\n---\n\nSee </#m>.\n'
    const findings = lint(source)
    expect(findings.map((item) => item.code)).toContain('frontmatter-crossref')
    expect(findings.map((item) => item.code)).not.toContain('broken-crossref')
    expect(findings.map((item) => item.code)).not.toContain('carve-version-unsupported')
    expect(findings.find((item) => item.code === 'frontmatter-crossref')?.severity).toBe('error')
  })

  it('reports duplicate metadata ids at the attribute line', () => {
    const source = 'a\n\n{#m}\n---yaml\nk: v\n---\n\n{#m}\n---toml\nk = 1\n---\n'
    const finding = parseWithDiagnostics(source).diagnostics.find((item) => item.code === 'duplicate-id')
    expect(finding?.range?.startOffset).toBe(source.indexOf('{#m}', source.indexOf('{#m}') + 1))
  })

  it('keeps included later blocks in the selected tree and flattened source', () => {
    const files = { 'a.crv': { text: '---\ntitle: B\n---\n\nx\n\n---yaml\nk: v\n---\n' } }
    const source = '{{ a.crv }}\n'
    const document = parse(source, { includes: { resolver: corpusResolver(files) } })
    expect(document.children[0]?.type).toBe('include')
    const output = flatten(document)
    expect(output.source).toBe('x\n\n---yaml\nk: v\n---\n')
    expect(output.same).toBe(true)
    const withoutPositions = parse(source, { positions: false, includes: { resolver: corpusResolver(files) } })
    expect(flatten(withoutPositions).source).toBe(output.source)
    const laterOnly = { 'a.crv': { text: '\n---yaml\nk: v\n---\n' } }
    const laterDocument = parse(source, { positions: false, includes: { resolver: corpusResolver(laterOnly) } })
    expect(flatten(laterDocument).source).toBe('---\nk: v\n---\n')
  })

  it('repairs a supplied literal typed opener with the canonical escape', () => {
    const document = { type: 'document', astVersion: '2.0', children: [
      { type: 'paragraph', children: [{ type: 'text', value: 'a' }] },
      { type: 'paragraph', children: [{ type: 'text', value: '---yaml' }] },
    ] } as DocumentNode
    expect(write(document)).toBe('a\n\n-\\--yaml\n')
    expect(format('a\n\n\\---yaml\nk: v\n\\---\n')).toBe('a\n\n\\---yaml\nk: v\n\\---\n')
  })
})
