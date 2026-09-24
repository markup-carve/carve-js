import { describe, expect, it } from 'vitest'
import { expandIncludes, parse, type IncludeSite, type IncludeWarning } from '../src/index.js'

// `IncludeWarning.includedBy` reports HOW the file a warning arose in was
// reached. A host that reconstructs that from the resolver calls it saw is
// exact only while every target is written once and reached once, because a
// repeated target resolves once per occurrence under one identity. The two
// shapes below are the ones that defeated the reconstruction
// (markup-carve/carve-lsp#224), so each asserts the occurrence, not just the
// path.

function expand(source: string, files: Record<string, string>) {
  const doc = parse(source, { positions: true })
  return expandIncludes(doc, source, {
    sourcePath: 'root.crv',
    resolve: (path) => (path in files ? { source: files[path]!, id: path } : null),
  })
}

/** The token each entry bounds, read back out of the file that wrote it. */
function tokens(
  warning: IncludeWarning,
  sources: Record<string, string>,
): Array<{ file: string | undefined; line: number; token: string }> {
  return (warning.includedBy ?? []).map((site: IncludeSite) => ({
    file: site.file,
    line: site.line,
    token: [...(sources[site.file!] ?? '')].slice(site.start, site.end).join(''),
  }))
}

function ofRule(result: { warnings: IncludeWarning[] }, rule: string): IncludeWarning[] {
  return result.warnings.filter((warning) => warning.rule === rule)
}

describe('an include warning names the directive that pulled it in', () => {
  it('a warning raised in the root document reports no reach', () => {
    const result = expand('{{ missing.crv }}\n', {})
    expect(result.warnings.map((w) => [w.rule, w.includedBy])).toEqual([
      ['include-unresolved', undefined],
    ])
  })

  it('a directive that fails to resolve inside a child reports the root directive', () => {
    const source = '{{ child.crv }}\n'
    const files = { 'child.crv': 'Body.\n\n{{ gone.crv }}\n' }
    const [warning] = ofRule(expand(source, files), 'include-unresolved')
    expect(warning!.file).toBe('child.crv')
    expect(tokens(warning!, { 'root.crv': source, ...files })).toEqual([
      { file: 'root.crv', line: 1, token: '{{ child.crv }}' },
    ])
  })

  it('a grandchild reports both hops, root first', () => {
    const source = 'Intro.\n\n{{ child.crv }}\n'
    const files = {
      'child.crv': 'Body.\n\n{{ deep.crv @shift:5 }}\n',
      'deep.crv': '## Deep\n',
    }
    const [warning] = ofRule(expand(source, files), 'include-heading-clamp')
    expect(warning!.file).toBe('deep.crv')
    expect(tokens(warning!, { 'root.crv': source, ...files })).toEqual([
      { file: 'root.crv', line: 3, token: '{{ child.crv }}' },
      { file: 'child.crv', line: 3, token: '{{ deep.crv @shift:5 }}' },
    ])
  })

  it('an inline directive is bounded to the token, not to the text around it', () => {
    const source = 'See {{ child.crv }} here.\n'
    const files = { 'child.crv': 'plain {{ gone.crv }} tail\n' }
    const [warning] = ofRule(expand(source, files), 'include-unresolved')
    expect(tokens(warning!, { 'root.crv': source, ...files })).toEqual([
      { file: 'root.crv', line: 1, token: '{{ child.crv }}' },
    ])
  })

  it('a renamed footnote label reports the directive that pulled the child in', () => {
    const source = 'Root[^n].\n\n[^n]: root note\n\n{{ child.crv }}\n'
    const files = { 'child.crv': 'Child[^n].\n\n[^n]: child note\n' }
    const [warning] = ofRule(expand(source, files), 'include-footnote-rename')
    expect(warning!.file).toBe('child.crv')
    expect(tokens(warning!, { 'root.crv': source, ...files })).toEqual([
      { file: 'root.crv', line: 5, token: '{{ child.crv }}' },
    ])
  })

  // Shape one of carve-lsp#224: the root writes the same target twice and the
  // occurrences degrade differently. Only the second clamps, so an anchor
  // dealt over the matching directives in document order lands on the first.
  it('the same target written twice reports the occurrence that degraded', () => {
    const source = '{{ child.crv }}\n\n{{ child.crv @shift:5 }}\n'
    const files = { 'child.crv': '## Deep\n' }
    const clamps = ofRule(expand(source, files), 'include-heading-clamp')
    expect(clamps).toHaveLength(1)
    expect(tokens(clamps[0]!, { 'root.crv': source, ...files })).toEqual([
      { file: 'root.crv', line: 3, token: '{{ child.crv @shift:5 }}' },
    ])
  })

  it('two occurrences that both degrade report one occurrence each', () => {
    const source = '{{ child.crv @shift:5 }}\n\n{{ child.crv @shift:5 }}\n'
    const files = { 'child.crv': '## Deep\n' }
    const clamps = ofRule(expand(source, files), 'include-heading-clamp')
    expect(clamps.map((w) => tokens(w, { 'root.crv': source, ...files })[0]!.line)).toEqual([1, 3])
  })

  // Shape two of carve-lsp#224: one canonical child reached under two
  // different top-level directives. Keyed by child id there is one chain, so
  // the earlier traversal's warning anchors at the later directive.
  it('a child reached under two top-level directives reports each reach', () => {
    const source = '{{ a.crv }}\n\n{{ b.crv }}\n'
    const files = {
      'a.crv': '{{ deep.crv @shift:5 }}\n',
      'b.crv': '{{ deep.crv @shift:5 }}\n',
      'deep.crv': '## Deep\n',
    }
    const clamps = ofRule(expand(source, files), 'include-heading-clamp')
    const sources = { 'root.crv': source, ...files }
    expect(clamps.map((w) => tokens(w, sources).map((entry) => entry.file))).toEqual([
      ['root.crv', 'a.crv'],
      ['root.crv', 'b.crv'],
    ])
    expect(clamps.map((w) => tokens(w, sources)[0]!.token)).toEqual(['{{ a.crv }}', '{{ b.crv }}'])
  })

  it('the reported reach is a snapshot, not the live walk', () => {
    const source = '{{ a.crv }}\n\n{{ b.crv }}\n'
    const files = {
      'a.crv': '{{ deep.crv @shift:5 }}\n',
      'b.crv': 'Plain.\n',
      'deep.crv': '## Deep\n',
    }
    const [warning] = ofRule(expand(source, files), 'include-heading-clamp')
    expect(warning!.includedBy).toHaveLength(2)
    expect(warning!.includedBy![0]!.file).toBe('root.crv')
    expect(warning!.includedBy![1]!.file).toBe('a.crv')
  })

  it('a root document with no sourcePath reports a reach with no file', () => {
    const source = '{{ child.crv }}\n'
    const files = { 'child.crv': '{{ gone.crv }}\n' }
    const doc = parse(source, { positions: true })
    const result = expandIncludes(doc, source, {
      resolve: (path) => (path in files ? { source: files[path]!, id: path } : null),
    })
    const [warning] = ofRule(result, 'include-unresolved')
    expect(warning!.includedBy).toEqual([{ line: 1, column: 1, start: 0, end: 15 }])
  })
})
