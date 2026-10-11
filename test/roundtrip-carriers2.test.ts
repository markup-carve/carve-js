import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { carveToHtml, carveToHtmlWithReport, carveToMarkdown, htmlToAst, htmlToCarve, migrateMarkdown, parse, renderHtml, renderMarkdown } from '../src/index.js'

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/roundtrip-carriers2.json', import.meta.url), 'utf8'))
function nodes(value: unknown): Record<string, any>[] {
  if (!value || typeof value !== 'object') return []
  return [...('type' in value ? [value as Record<string, any>] : []), ...Object.values(value).flatMap(nodes)]
}
function projection(tree: unknown, expected: Record<string, unknown>[]) {
  for (const row of expected) {
    expect(nodes(tree).some(node => Object.entries(row).every(([path, value]) => {
      const actual = path.split('.').reduce((at, key) => at?.[key], node)
      return JSON.stringify(actual) === JSON.stringify(value)
    }))).toBe(true)
  }
}

describe('new roundtrip carriers', () => {
  it('leaves blank lines empty when restoring a definition body', () => {
    const source = ':: Carve\n: A markup language.\n  :: inner\n  : def\n'
    expect(migrateMarkdown(carveToMarkdown(source, { roundtrip: true })).value)
      .toBe(':: Carve\n: A markup language.\n\n  *inner*\n\n  def\n')
  })
  it.each([
    '{.c}\n:: Carve\n: A markup language.\n',
    ...fixtures.markdownExportImport.filter((row: { id: string }) => ['definition-list', 'heading-attribute-line', 'quote-caption'].includes(row.id)).map((row: { source: string }) => row.source),
    'Before.\n\n{.c}\n:: Carve\n: A markup language.\n\nAfter.\n',
  ])('restores canonical spacing %j', source => {
    expect(migrateMarkdown(carveToMarkdown(source, { roundtrip: true })).value).toBe(source)
  })
  for (const row of fixtures.markdownExportImport) it(row.id, () => {
    projection(parse(row.source), row.expectedNodes)
    expect(carveToMarkdown(row.source, { roundtrip: false })).toBe(carveToMarkdown(row.source))
    expect(carveToMarkdown(row.source)).not.toContain('<!-- carve:')
    const markdown = carveToMarkdown(row.source, { roundtrip: true })
    for (const fragment of row.carrierFragments) expect(markdown).toContain(fragment)
    const result = migrateMarkdown(markdown)
    expect(result.report.diagnostics.filter(d => d.code === 'carrier-markers-damaged')).toEqual([])
    projection(parse(result.value), row.expectedNodes)
    expect(carveToHtml(result.value)).toBe(carveToHtml(row.source))
  })
  for (const row of fixtures.exportImport) it(row.id, () => {
    expect(carveToHtml(row.source)).not.toContain('data-carve-label')
    const html = carveToHtml(row.source, { roundtrip: true })
    expect(html).toContain('<pre data-carve-label="Example">')
    for (const mode of ['safe', 'semantic', 'roundtrip'] as const) {
      for (const prefix of ['data-carve', 'data-djot']) {
        const input = html.replaceAll('data-carve-label', `${prefix}-label`)
        projection(htmlToAst(input, { mode }).value, row.expectedNodes)
        const restored = htmlToCarve(input, { mode }).value
        expect(restored).not.toContain(`${prefix}-label`)
        expect(carveToHtml(restored)).toBe(carveToHtml(row.source))
      }
    }
  })
  it.each([
    '::: \\\nline one\nline two\n:::\n',
    '![a](x.png)\n^ Caption\n',
    '$$`E = mc^2`\n^ Equation #: mass-energy\n',
    '```js\nx\n```\n^ Listing #\n',
    ':: First\n:: Alias\n: One\n\n  Two\n: Three\n:: Next\n: Four\n\nAfter.\n',
    '> :: Term\n> : One\n>\n>   Two\n',
    '- :: Term\n  : One\n\n    Two\n',
    ':: Term\n: {empty}\n',
    ':: Term\n: {empty}\n: Other\n',
    ':: Term\n: ::: note\n  Body\n  :::\n',
    '{.x}\n- one\n',
    ':: First\n: One\n\nParagraph.\n\n{.c}\n:: Second\n: Two\n',
    '{.x}\n> Quote\n',
    '{.x}\n|= Header |\n| Cell |\n',
    '::: note\n{.x}\nBody\n:::\n',
    '> {.x}\n> Body\n',
    '- {.x}\n  Body\n',
    '::: figure\n:::: panel\n![a](x.png)\n^ Panel caption\n::::\n:::\n^ Group caption\n',
    '![a](x.png)\n^ Caption with --\\> and -->\n\nCaption with --\\> and -->\n',
  ])('restores additional hosts %j', source => {
    const markdown = carveToMarkdown(source, { roundtrip: true })
    const result = migrateMarkdown(markdown)
    expect(result.report.diagnostics.filter(d => d.code === 'carrier-markers-damaged')).toEqual([])
    expect(carveToHtml(result.value)).toBe(carveToHtml(source))
  })
  it.each([
    '{.x}\n---\n',
    '{.x}\n***\n',
    '{.x}\n___\n',
    '{.x}\n===\n',
    '{.x}\nText\ncontinued\n',
    '::: note\nText\n:::\n\n---\n',
    '![a](x.png)\n^ Cap\n\n---\n',
    ':: Term\n: Definition\n\n---\n',
    '{#h}\n# H\n---\n',
    '{.x}\n$$`x`\n^ Cap\n',
    '- {.x}\n  $$`x`\n  ^ Cap\n',
    '- $$`x`\n  ^ Cap\n',
  ])('preserves marker boundaries and equation hosts %j', source => {
    const result = migrateMarkdown(carveToMarkdown(source, { roundtrip: true }))
    const structural = (tree: unknown): unknown => JSON.parse(JSON.stringify(tree, (key, value) => ['pos', 'srcByteLength', 'marker', 'termSpans', 'definitionLines', 'definitionSpans'].includes(key) ? undefined : value))
    expect(result.report.diagnostics.filter(d => d.code === 'carrier-markers-damaged')).toEqual([])
    expect(structural(parse(result.value))).toEqual(structural(parse(source)))
    expect(carveToHtml(result.value)).toBe(carveToHtml(source))
  })
  it.each(['<!-- carve: {.x} -->', '<!-- carve: :: Term -->', '<!-- carve: : -->', '<!-- carve: -->', '<!-- carve: ^ Caption -->', '<!-- carve: ::: | -->'])('ignores markers in verbatim content %s', marker => {
    for (const markdown of [`\`\`\`text\n${marker}\n\`\`\`\n`, `- Item\n\n      ${marker}\n`]) {
      expect(migrateMarkdown(markdown).report.diagnostics.some(d => d.code === 'carrier-markers-damaged')).toBe(false)
      expect(migrateMarkdown(markdown).value).toContain(marker)
    }
  })
  it.each([
    ':: Outer\n: One\n\n  :: Inner\n  : Two\n  :: Last\n  : Three\n',
    ':: Outer\n: > :: Inner\n  > : Definition\n',
    ':: Outer\n: One\n\n  {.nested}\n  :: Inner\n  : Two\n',
  ])('carries only the outer definition list %j', source => {
    const markdown = carveToMarkdown(source, { roundtrip: true })
    expect(markdown.match(/<!-- carve: :: /g)).toHaveLength(1)
    expect(markdown.match(/<!-- carve: : -->/g)).toHaveLength(1)
    expect(markdown.match(/<!-- carve: -->/g)).toHaveLength(1)
    expect(markdown).not.toContain('<!-- carve: {.nested} -->')
    const result = migrateMarkdown(markdown)
    expect(result.report.diagnostics.filter(d => d.code === 'carrier-markers-damaged')).toEqual([])
    const restored = parse(result.value)
    expect(nodes(restored).filter(node => node.type === 'definition_list')).toHaveLength(1)
    expect(restored.children[0]).toMatchObject({ type: 'definition_list', items: [{ terms: [[{ type: 'text', value: 'Outer' }]] }] })
    const outer = parse(source).children[0]
    if (outer.type !== 'definition_list') throw new Error('Expected a definition list')
    const degraded = migrateMarkdown(renderMarkdown({ type: 'document', children: outer.items[0]!.definitions[0]! })).value
    const expected = parse(`:: Outer\n: ${degraded.trimEnd().replaceAll('\n', '\n  ')}\n`)
    expect(carveToHtml(result.value)).toBe(renderHtml(expected))
  })
  it.each([
    '{.c}\n:: Carve\n: A markup language.\n',
    '> {.c}\n> :: Carve\n> : A markup language.\n',
    '- {.c}\n  :: Carve\n  : A markup language.\n',
  ])('attaches a definition-list attribute marker to the list %j', source => {
    const markdown = carveToMarkdown(source, { roundtrip: true })
    expect(markdown).toMatch(/<!-- carve: {\.c} -->\n[^\n]*<!-- carve: :: Carve -->/)
    const result = migrateMarkdown(markdown)
    expect(result.report.diagnostics.filter(d => d.code === 'carrier-markers-damaged')).toEqual([])
    expect(nodes(parse(result.value)).find(node => node.type === 'definition_list')).toMatchObject({ attrs: { classes: ['c'] } })
    expect(carveToHtml(result.value)).toBe(carveToHtml(source))
  })
  it('does not carry a generated heading id', () => {
    expect(carveToMarkdown('# Heading\n', { roundtrip: true })).not.toContain('<!-- carve:')
  })
  it('places the HTML label before authored attributes and reports collisions', () => {
    const result = carveToHtmlWithReport('{.code data-carve-label=lost}\n```js [A & "B"]\nx\n```\n', { roundtrip: true })
    expect(result.value).toContain('<pre data-carve-label="A &amp; &quot;B&quot;" class="code">')
    expect(result.losses).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'carrier-attribute-dropped', attribute: 'data-carve-label' })]))
  })
  it('prefers the canonical label and consumes labels on other hosts', () => {
    for (const mode of ['safe', 'semantic', 'roundtrip'] as const) {
      expect(htmlToAst('<pre data-carve-label="New" data-djot-label="Old"><code>x</code></pre>', { mode }).value.children[0]).toMatchObject({ label: 'New' })
      for (const html of ['<pre data-carve-label="Label">x</pre>', '<p data-djot-label="Label">x</p>']) {
        const tree = htmlToAst(html, { mode }).value
        expect(tree.children[0]).not.toHaveProperty('label')
        expect(JSON.stringify(tree)).not.toContain('data-carve-label')
        expect(JSON.stringify(tree)).not.toContain('data-djot-label')
      }
    }
  })
  it.each(['', 'bad]', 'bad\nlabel', 'bad\rlabel'])('rejects an invalid HTML label %j', label => {
    for (const mode of ['safe', 'semantic', 'roundtrip'] as const) {
      const result = htmlToAst(`<pre data-carve-label="${label}"><code>x</code></pre>`, { mode })
      expect(result.value.children[0]).not.toHaveProperty('label')
      expect(JSON.stringify(result.value)).not.toContain('data-carve-label')
      expect(result.report.diagnostics.some(d => d.code === 'attribute-dropped')).toBe(true)
    }
  })
  it.each([
    '<!-- carve: {.c} -->\n\nText.\n',
    '<!-- carve: {.c} -->\n',
    '<!-- carve: :: Term -->\n**Term**\n\n<!-- carve: -->\n',
    '<!-- carve: : -->\nDefinition.\n<!-- carve: -->\n',
    '<!-- carve: :: Term -->\n**Term**\n\n<!-- carve: : -->\nDefinition.\n',
    '<!-- carve: -->\n',
    '<!-- carve: ^ Caption -->\nCaption\n',
    'Text.\n\n<!-- carve: ^ Caption -->\nCaption\n',
    '<!-- carve: ::: | -->\nLine\n',
    '<!-- carve: {.c} -->\n<!-- carve: {.d} -->\nText\n',
    '<!-- carve: :: First -->\n**First**\n\n<!-- carve: : -->\nOne\n\n<!-- carve: {.c} -->\n<!-- carve: :: Second -->\n**Second**\n\n<!-- carve: : -->\nTwo\n\n<!-- carve: -->\n',
    '<!-- carve: :: Term -->\n# Term\n<!-- carve: : -->\nDefinition\n<!-- carve: -->\n',
    '<!-- carve: ::: note -->\nBody\n<!-- carve: ::: -->\n<!-- carve: ^ Caption -->\nCaption\n',
    '> Quote\n\n<!-- carve: ^ First -->\nFirst\n\n<!-- carve: ^ Second -->\nSecond\n',
  ])('falls back for damaged markers %j', markdown => {
    const result = migrateMarkdown(markdown)
    expect(result.report.diagnostics.filter(d => d.code === 'carrier-markers-damaged')).toHaveLength(1)
    expect(result.value).toContain('<!-- carve:')
    expect(result.report.diagnostics.find(d => d.code === 'carrier-markers-damaged')).toMatchObject({ fidelity: 'degraded', confidence: 'fallback' })
  })
})
