import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToHtml, createEditorSession, diffAst, lintCarve, mergeAst, parseWithSourceLayout } from '../src/index.js'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.js'

const paragraphs = (n: number, value: string) => `${value}\n\n`.repeat(n)

describe('remaining scan costs', () => {
  it('keeps failed destinations literal and accepts balanced destinations', () => {
    expect(carveToHtml('[x]([x]([x]()')).toBe('<p>[x]([x]([x]()</p>')
    expect(carveToHtml('[x](a(b)c "title")')).toContain('href="a(b)c" title="title"')
  })

  it('rejects quoted invalid attributes without losing the trailing valid span', () => {
    const input = '[x]{k="'.repeat(40) + '"}'
    expect(carveToHtml(input).match(/<span /g)).toHaveLength(1)
    expect(carveToHtml('[x]{k="a"[y]{.b}')).toContain('<span class="b">y</span>')
    expect(carveToHtml('[x]{k="a" .b}')).toContain('k="a"')
  })

  it('keeps platform lint columns after astral text', () => {
    const diagnostics = lintCarve('😀😀[x](uu)#12', { platforms: ['github'] })
    const findings = diagnostics.filter(diagnostic => diagnostic.rule === 'platform-issue-reference')
    expect(findings).toHaveLength(1)
    expect(findings[0]!.column).toBe(12)
  })

  it('maps scalar offsets to UTF-8 bytes', () => {
    const source = '# 😀é\n\ntext\n'
    const { layout } = parseWithSourceLayout(source)
    expect(layout.nodes).toContainEqual({ path: '/children/0/children/0', startByte: 2, endByte: 8 })
    expect(layout.nodes).toContainEqual({ path: '/children/1', startByte: 10, endByte: 14 })
  })

  it('reports every changed paragraph past the LCS limit', () => {
    const changes = diffAst(carveToAstJson(paragraphs(1100, 'a')), carveToAstJson(paragraphs(1100, 'b')))
    expect(changes.filter(change => change.kind === 'changed')).toHaveLength(1100)
  })

  it('reports a single move across the diff budget', () => {
    const blocks = Array.from({ length: 1100 }, (_, i) => `p${i}`)
    for (const moved of [[...blocks.slice(1), blocks[0]!], [blocks.at(-1)!, ...blocks.slice(0, -1)]]) {
      const changes = diffAst(carveToAstJson(blocks.join('\n\n')), carveToAstJson(moved.join('\n\n')))
      expect(changes.filter(change => change.kind === 'moved')).toHaveLength(1)
    }
  })

  it('keeps small duplicate diff tie breaks', () => {
    const changes = diffAst(carveToAstJson('y\n\np\n\nx\n\np\n\np\n\ny'), carveToAstJson('p\n\ny'))
    expect(changes.filter(change => change.kind === 'removed').map(change => change.path)).toEqual(['/children[0]', '/children[2]', '/children[3]', '/children[4]'])
  })

  it('keeps shifted duplicate diffs compact past the budget', () => {
    const blocks = Array.from({ length: 1500 }, (_, i) => `q${i % 3}`)
    const shifted = ['z', ...blocks.slice(1), blocks[0]!, 'z']
    const changes = diffAst(carveToAstJson(blocks.join('\n\n')), carveToAstJson(shifted.join('\n\n')))
    expect(changes.filter(change => change.kind === 'moved').length).toBeLessThanOrEqual(2)
    expect(changes.filter(change => change.kind === 'added')).toHaveLength(2)
  })

  it('preserves editor attribute tokens across CRLF and CR lines', () => {
    for (const ending of ['\r\n', '\r']) {
      const nodes = createEditorSession(`{.a}${ending}word${ending}`).snapshot().nodes
      const paragraph = nodes.find(node => node.type === 'paragraph')
      expect(paragraph?.tokens).toContainEqual({ role: 'attribute', start: 0, end: 4 })
    }
  })

  it('rejects concurrent additions with the same identity and different content', () => {
    const base = carveToAstJson('')
    const ours = carveToAstJson('{#h}\na\n')
    const different = mergeAst(base, ours, carveToAstJson('{#h}\nb\n'))
    expect(different.ok).toBe(false)
    if (!different.ok) expect(different.conflicts[0]!.reason).toBe('concurrent-sequence-edit')
    const identical = mergeAst(base, ours, carveToAstJson('{#h}\na\n\nextra\n'))
    expect(identical.ok).toBe(true)
    if (identical.ok) expect(identical.ast.children).toHaveLength(2)
  })

  it('deduplicates concurrent additions in occurrence order', () => {
    const result = mergeAst(carveToAstJson(''), carveToAstJson('a\n\na\n\nb\n'), carveToAstJson('a\n\nb\n\nb\n'))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.ast.children).toHaveLength(4)
  })

  for (const unit of ['[x](', '*[x](', '[x]{k="', '[x]{k=', '[x]{k=a ', ':foo[x]{k="', '^[', '[^', '{~', '{=', '{#', '[x](a){', ':foo[', '<a:x>{']) {
    perfIt(`failed tail ${unit} scales with source bytes`, () => {
      expectBuiltInputScansLinearly(input => void carveToHtml(input), n => unit.repeat(n) + (unit.includes('{') ? '"}' : ')'), { smallRepeats: 2000, label: unit })
    })
  }

  for (const [unit, suffix] of [['[x][r]{', ''], ['[x][r]{.b ', '}'], ['[^a ', '\n]'], ['[x]{k=', '}'], ['[x]{k=', '']]) {
    perfIt(`failed tail ${unit} with ${JSON.stringify(suffix)} stays bounded`, () => {
      expectBuiltInputScansLinearly(input => void carveToHtml(input), n => unit!.repeat(n) + suffix!, { smallRepeats: 2000, label: unit })
    })
  }

  perfIt('table warning positions avoid document prefix scans', () => {
    expectBuiltInputScansLinearly(input => void lintCarve(input), n => '{widths="60,50"}\n| a | b |\n\n'.repeat(n), { smallRepeats: 500, label: 'table warning positions' })
  })

  it('bounds edit-boundary lookups across many mapped nodes', () => {
    const session = createEditorSession('a\n\n'.repeat(1000))
    let boundaryReads = 0
    const changes = Array.from({ length: 500 }, (_, i) => ({
      from: i * 6,
      get to() { boundaryReads++; return i * 6 + 1 },
      insert: 'bb',
    }))
    const update = session.update(changes)
    expect(update.source).toBe('bb\n\na\n\n'.repeat(500))
    expect(boundaryReads).toBeLessThan(50_000)
  })

  perfIt('batched editor updates index edits once', () => {
    expectBuiltInputScansLinearly(input => {
      const session = createEditorSession(input)
      const changes = Array.from({ length: input.length / 6 }, (_, i) => ({ from: i * 6, to: i * 6 + 1, insert: 'bb' }))
      session.update(changes)
    }, n => 'a\n\n'.repeat(n), { smallRepeats: 4000, label: 'batched editor updates' })
  })

  it('maps empty includes across mention and tag spans', () => {
    const source = '@user {{ }} @next {{ #x }}'
    const warnings = lintCarve(source).filter(warning => warning.rule === 'empty-include-path')
    expect(warnings.map(warning => source.slice(warning.start, warning.end))).toEqual(['{{ }}', '{{ #x }}'])
    expect(warnings.map(warning => warning.column)).toEqual([7, 19])
  })

  perfIt('empty include warnings advance through inline spans', () => {
    expectBuiltInputScansLinearly(input => void lintCarve(input), n => '@user {{ }} '.repeat(n), { smallRepeats: 1000, label: 'empty include inline spans' })
  })

  perfIt('source layout scales with positioned paragraphs', () => {
    expectBuiltInputScansLinearly(input => void parseWithSourceLayout(input), n => paragraphs(n, 'a'), { smallRepeats: 1000, label: 'source layout' })
  })

  perfIt('large changed sibling lists stay bounded', () => {
    expectBuiltInputScansLinearly(input => void diffAst(carveToAstJson(input), carveToAstJson(input.replaceAll('a', 'b'))), n => paragraphs(n, 'a'), { smallRepeats: 2000, label: 'AST diff' })
  })

  perfIt('concurrent additions use indexed matching', () => {
    const base = carveToAstJson('')
    expectBuiltInputScansLinearly(input => void mergeAst(base, carveToAstJson(input), carveToAstJson(input.replaceAll('a', 'b'))), n => paragraphs(n, 'a'), { smallRepeats: 1000, label: 'merge additions' })
  })

  perfIt('platform lint masks failed destinations once', () => {
    expectBuiltInputScansLinearly(input => void lintCarve(input, { platforms: ['github'] }), n => '[x]('.repeat(n) + ')', { smallRepeats: 2000, label: 'lint destinations' })
  })

  perfIt('editor attribute token mapping avoids prefix rescans', () => {
    expectBuiltInputScansLinearly(input => void createEditorSession(input), n => '{.a}\na\n\n'.repeat(n), { smallRepeats: 1000, label: 'editor attributes' })
  })
})
