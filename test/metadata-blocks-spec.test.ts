import { describe, expect, it } from 'vitest'
import { parse, parseWithDiagnostics, render } from '../src/api.ts'
import { flatten } from '../src/flatten.ts'
import { format } from '../src/format.ts'
import { write, writeWithDiagnostics } from '../src/write.ts'
import { lint } from '../lint/lint.ts'
import { corpusResolver } from '../scripts/corpus.ts'
import { type DocumentNode } from '../src/ast.ts'

describe('typed metadata blocks, C2-B-231 to C2-W-153', () => {
  it('reads a column-zero typed opener after a list without a blank line as a lazy line (carve#6389)', () => {
    const source = '- a\n---yaml\nk: v\n---\n'
    expect(parse(source).children.map((node) => node.type)).toEqual(['list'])
    expect(render(source)).toBe('<ul>\n  <li>a\n—yaml\nk: v\n—</li>\n</ul>')
  })

  it('C2-W-154: writes the paragraph directly below a list that ends in a block without lazy lines (carve#6394)', () => {
    const lists = ['- ```\n  x\n  ```', '- :::\n  x\n  :::', '- | a | b |', '- = H', '- a\n  - ```\n    x\n    ```', '- ***',
      '- > ```\n  > x\n  > ```', '- > = H', '- ::: >\n  q\n  :::', '- ::: |\n  a\n  :::',
      '- %%%\n  hi\n  %%%']
    for (const list of lists) {
      const source = `${list}\n---yaml\nk: v\n---\n`
      expect(format(source)).toBe(source)
    }
  })

  it('C2-W-154: keeps the blank line where the first line is no typed opener', () => {
    expect(format('- = H\n---yaml *x*\n')).toBe('- = H\n\n---yaml *x*\n')
  })

  it('C2-W-154: refuses the paragraph below a list that ends in a block with lazy lines', () => {
    const tree = parse('- ```\n  x\n  ```\n---yaml\nk: v\n---\n')
    const [list, paragraph] = tree.children
    const quoted = parse('- > q\n').children[0]!
    const result = writeWithDiagnostics({ ...tree, children: [quoted, paragraph!] })
    expect(list?.type).toBe('list')
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(['structure-unspellable'])
  })

  it('C2-W-154: indents the first line of a top-level paragraph that would read as a typed opener', () => {
    for (const source of ['a\n\n ---yaml\nk: v\n---\n', ' ---yaml\nk: v\n---\n', '- a\n\n{.c}\n ---yaml\nk: v\n---\n']) {
      const result = writeWithDiagnostics(parse(source))
      expect(result.source).toBe(source)
      expect(result.diagnostics).toEqual([])
    }
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
