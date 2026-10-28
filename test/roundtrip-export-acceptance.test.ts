import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { test } from 'vitest'
import { parseFragment, serialize } from 'parse5'
import { parse, carveToHtml, carveToHtmlWithReport, htmlToAst, htmlToCarve, carveToMarkdown, carveToMarkdownWithReport, migrateMarkdown } from '../src/index.js'

const fixtures = JSON.parse(readFileSync(new URL('../spec/resources/roundtrip-export-acceptance-fixtures.json', import.meta.url), 'utf8'))
const inventory = ['explicit-id', 'generated-id', 'ref', 'autolink', 'footnote-label', 'inline-footnote', 'raw', 'escaped', 'abbreviations', 'col-widths', 'label', 'id-slot', 'tight', 'xref', 'caption-number', 'div', 'line-block', 'substitution']
// Reserved without an inventory row: no core writer emits it, every importer consumes it.
const retiredNames = ['data-carve-src', 'data-djot-src']
const reservedNames = new Set(['data-marker', 'data-char', ...retiredNames, ...inventory.flatMap((name) => [`data-carve-${name}`, `data-djot-${name}`])])
const isReserved = (name: string) => reservedNames.has(name)
const field = (node: Record<string, any>, path: string) => path.split('.').reduce((value, key) => value?.[key], node)
function nodes(value: any): Record<string, any>[] {
  if (!value || typeof value !== 'object') return []
  return [...(typeof value.type === 'string' ? [value] : []), ...Object.values(value).flatMap(nodes)]
}
function assertProjection(tree: unknown, expected: Record<string, unknown>[]) {
  const remaining = nodes(tree)
  for (const projection of expected) {
    const index = remaining.findIndex((node) => Object.entries(projection).every(([key, value]) => {
      try { assert.deepEqual(field(node, key), value === null ? undefined : value); return true } catch { return false }
    }))
    assert.notEqual(index, -1, JSON.stringify(projection))
    remaining.splice(index, 1)
  }
}
function assertImportProjection(tree: unknown, fixture: { expectedNodes: Record<string, unknown>[]; fallbackNodes?: Record<string, unknown>[] }) {
  try { assertProjection(tree, fixture.expectedNodes); return false } catch (error) {
    if (!fixture.fallbackNodes) throw error
    assertProjection(tree, fixture.fallbackNodes)
    return true
  }
}
function htmlAttributes(html: string) {
  const out: { name: string; value: string; element: string }[] = []
  function visit(node: any) { out.push(...(node.attrs ?? []).map((attr: {name: string; value: string}) => ({ ...attr, element: node.tagName }))); for (const child of node.childNodes ?? []) visit(child); if (node.content) visit(node.content) }
  visit(parseFragment(html))
  return out
}
function deprecatedHtml(html: string) {
  const fragment = parseFragment(html)
  function visit(node: any) {
    for (const attr of node.attrs ?? []) {
      if (inventory.some((name) => attr.name === `data-carve-${name}`)) attr.name = attr.name.replace('data-carve-', 'data-djot-')
    }
    for (const child of node.childNodes ?? []) visit(child)
    if (node.content) visit(node.content)
  }
  visit(fragment)
  return serialize(fragment)
}
function assertNoReservedAttrs(tree: unknown) {
  for (const node of nodes(tree)) {
    for (const key of Object.keys(node.attrs?.keyValues ?? {})) assert.ok(!isReserved(key), key)
  }
}
function carrierElements(html: string, name: string) {
  const found: any[] = []
  function visit(node: any) {
    if ((node.attrs ?? []).some((attr: {name: string}) => attr.name === name)) found.push(node)
    for (const child of node.childNodes ?? []) visit(child)
    if (node.content) visit(node.content)
  }
  visit(parseFragment(html))
  return found
}
function carrierText(node: any) {
  return (node.content?.childNodes ?? node.childNodes ?? []).map((child: {nodeName: string; value: string}) => {
    assert.equal(child.nodeName, '#text', 'carrier payload must contain only escaped text')
    return child.value
  }).join('')
}
const normalizedHtml = (html: string) => html.trim()
const HEADING_CARRIER_ORDER_AHEAD = new Set<string>()

for (const fixture of fixtures.exportImport) {
  test(`shared roundtrip export: ${fixture.id}`, () => {
    assertProjection(parse(fixture.source), fixture.expectedNodes)
    const ordinary = carveToHtml(fixture.source)
    assert.equal(carveToHtml(fixture.source, { roundtrip: false }), ordinary)
    assert.ok(!htmlAttributes(ordinary).some((attr) => isReserved(attr.name)))
    const exported = carveToHtml(fixture.source, { roundtrip: true })
    if (fixture.exportedHtml !== undefined) {
      const pinned = fixture.exportedHtml.replace(/\n+$/, '')
      const expected = HEADING_CARRIER_ORDER_AHEAD.has(fixture.id)
        ? pinned.replace(/<section id="([^"]+)" (data-carve-(?:generated|explicit)-id="1")>/, '<section $2 id="$1">')
        : pinned
      assert.equal(exported.replace(/\n+$/, ''), expected)
      if (HEADING_CARRIER_ORDER_AHEAD.has(fixture.id)) assert.notEqual(expected, pinned)
    }
    const attrs = htmlAttributes(exported)
    for (const [name, expected] of Object.entries(fixture.carrierText ?? {})) {
      const hosts = carrierElements(exported, name)
      assert.equal(hosts.length, 1, name)
      const allowed = Array.isArray(expected) ? expected : [expected]
      assert.ok(allowed.includes(carrierText(hosts[0])), name)
    }
    assert.ok(!attrs.some((attr) => isReserved(attr.name) && attr.name.startsWith('data-djot-')))
    assert.ok(attrs.filter((attr) => isReserved(attr.name)).every((attr) => Object.hasOwn(fixture.carriers, attr.name)))
    for (const [name, value] of Object.entries(fixture.carriers)) assert.ok(attrs.some((attr) => attr.name === name && (value === null || attr.value === value)), `${name}=${value}`)
    for (const host of fixture.carrierHosts) assert.ok(attrs.some((attr) => attr.name === host.attribute && attr.element === host.element), JSON.stringify(host))
    for (const [name, value] of Object.entries(fixture.ordinaryAttributes ?? {})) {
      for (const html of [ordinary, exported]) assert.ok(htmlAttributes(html).some((attr) => attr.name === name && attr.value === value))
    }
    for (const name of fixture.forbiddenExportAttributes) assert.ok(!attrs.some((attr: {name: string}) => attr.name === name), name)
    for (const roundtrip of [false, true]) {
      const codes = carveToHtmlWithReport(fixture.source, { roundtrip }).losses.map((row) => row.code)
      for (const code of fixture.lossCodes ?? []) assert.ok(codes.includes(code), `${code} with roundtrip ${roundtrip}`)
    }
    for (const mode of fixture.importModes) {
      const imported = htmlToAst(exported, { mode })
      const legacy = htmlToAst(deprecatedHtml(exported), { mode })
      assertImportProjection(legacy.value, fixture)
      assertNoReservedAttrs(legacy.value)
      const declined = assertImportProjection(imported.value, fixture)
      assertNoReservedAttrs(imported.value)
      for (const absent of fixture.expectedAbsentFields ?? []) assert.ok(nodes(imported.value).filter((node) => node.type === absent.type).every((node) => field(node, absent.field) === undefined))
      const source = htmlToCarve(exported, { mode }).value
      for (const fragment of fixture.returnedSourceFragments ?? []) assert.ok(source.includes(fragment), fragment)
      assert.equal(normalizedHtml(carveToHtml(source)), normalizedHtml(declined ? fixture.fallbackHtml : ordinary), mode)
    }
  })
}
for (const fixture of fixtures.importNegative) {
  for (const mode of fixture.importModes) test(`shared carrier rejection: ${fixture.id}/${mode}`, () => {
    const result = htmlToAst(fixture.html, { mode })
    assertProjection(result.value, fixture.expectedNodes)
    if (fixture.requiresDiagnostic) {
      const controlCount = fixture.diagnosticControlHtml ? htmlToAst(fixture.diagnosticControlHtml, { mode }).report.diagnostics.length : 0
      assert.ok(result.report.diagnostics.length > controlCount, fixture.id)
    }
    if (fixture.expectedDiagnostic) assert.ok(result.report.diagnostics.some((row) => Object.entries(fixture.expectedDiagnostic).every(([key, value]) => (row as unknown as Record<string, unknown>)[key] === value)))
    assertNoReservedAttrs(result.value)
    for (const fragment of fixture.forbiddenSourceSubstrings ?? []) assert.ok(!htmlToCarve(fixture.html, { mode }).value.includes(fragment), fragment)
    for (const fragment of fixture.forbiddenAstSubstrings ?? []) assert.ok(!JSON.stringify(result.value).includes(fragment), fragment)
    for (const fragment of fixture.forbiddenRenderedSubstrings ?? []) assert.ok(!carveToHtml(htmlToCarve(fixture.html, { mode }).value).includes(fragment), fragment)
    for (const type of fixture.forbiddenTypes) assert.ok(!nodes(result.value).some((node) => node.type === type), type)
    for (const absent of fixture.expectedAbsentFields ?? []) assert.ok(nodes(result.value).filter((node) => node.type === absent.type).every((node) => field(node, absent.field) === undefined))
    for (const forbidden of fixture.forbiddenFieldValues ?? []) assert.ok(nodes(result.value).filter((node) => node.type === forbidden.type).every((node) => field(node, forbidden.field) !== forbidden.value))
  })
}
test('export cannot enable a denied destination', () => {
  const result = carveToHtmlWithReport('[x](javascript:one)\n', { roundtrip: true })
  assert.ok(!result.value.includes('javascript:'))
  assert.ok(result.losses.some((row) => row.code === 'destination-denied'))
})
test('shared paired-footnote controls remain a separate complete resource', () => {
  const paired = JSON.parse(readFileSync(new URL(`../spec/resources/${fixtures.footnoteRecoveryResource}`, import.meta.url), 'utf8'))
  for (const fixture of paired) {
    const result = htmlToCarve(fixture.html, { mode: fixture.mode })
    assert.equal(result.value, fixture.expectedSource, fixture.name)
    assertNoReservedAttrs(htmlToAst(fixture.html, { mode: fixture.mode }).value)
  }
})

for (const fixture of fixtures.collisionExport) test(`shared export collision: ${fixture.id}`, () => {
  const named = (html: string) => htmlAttributes(html).filter((attr) => attr.name === fixture.attribute).map((attr) => attr.value)
  const result = carveToHtmlWithReport(fixture.source, { roundtrip: true })
  if (fixture.kept) {
    assert.deepEqual(named(result.value), [fixture.value])
    assert.ok(!result.losses.some((row) => row.code === 'carrier-attribute-dropped'))
    return
  }
  assert.deepEqual(named(result.value), fixture.value === null ? [] : [fixture.value])
  assert.ok(result.losses.some((row) => row.code === 'carrier-attribute-dropped' && row.attribute === fixture.attribute))
  if (fixture.defaultValue === undefined) return
  const ordinary = carveToHtmlWithReport(fixture.source)
  assert.deepEqual(named(ordinary.value), [fixture.defaultValue])
  assert.ok(!ordinary.losses.some((row) => row.code === 'carrier-attribute-dropped'))
})
test('task hooks remain ordinary output without preservation export', () => {
  const fixture = fixtures.exportImport.find((row: {id: string; source: string}) => row.id === 'task-states')
  const html = carveToHtml(fixture.source)
  assert.ok(html.includes('task-list'))
  for (const state of ['x', '-', '_', '>', '?']) assert.ok(htmlAttributes(html).some((attr) => attr.name === 'data-task-state' && attr.value === state), state)
})

for (const fixture of fixtures.markdownExportImport) test(`shared Markdown export: ${fixture.id}`, () => {
  assertProjection(parse(fixture.source), fixture.expectedNodes)
  const ordinary = carveToMarkdown(fixture.source)
  assert.equal(carveToMarkdown(fixture.source, { roundtrip: false }), ordinary)
  assert.ok(!ordinary.includes('<!-- carve:'))
  for (const fragment of fixture.ordinaryFragments ?? []) assert.ok(ordinary.includes(fragment), fragment)
  for (const fragment of fixture.forbiddenOrdinaryFragments ?? []) assert.ok(!ordinary.includes(fragment), fragment)
  if (fixture.defaultExportOnly) return
  const exported = carveToMarkdown(fixture.source, { roundtrip: true })
  if (fixture.inlineMarkers) assert.equal(exported.replace(/<!-- carve: [\s\S]*? -->/g, ''), ordinary)
  for (const fragment of fixture.carrierFragments) assert.ok(exported.includes(fragment), fragment)
  const codes = carveToMarkdownWithReport(fixture.source, { roundtrip: true }).losses.map((row) => row.code)
  for (const code of fixture.lossCodes ?? []) assert.ok(codes.includes(code), code)
  for (const code of fixture.forbiddenLossCodes ?? []) assert.ok(!codes.includes(code), code)
  const imported = migrateMarkdown(exported)
  assertProjection(parse(imported.value), fixture.expectedNodes)
  // A declared loss moves the output by definition; the spec harness skips the comparison too.
  if ((fixture.lossCodes ?? []).length === 0) assert.equal(carveToHtml(imported.value).trim(), carveToHtml(fixture.source).trim())
})

for (const fixture of fixtures.markdownImportNegative ?? []) test(`shared Markdown import rejection: ${fixture.id}`, () => {
  const imported = migrateMarkdown(fixture.markdown)
  const tree = parse(imported.value)
  const codes = imported.report.diagnostics.map((row) => row.code as string)
  if (fixture.expectedDiagnostic) assert.ok(codes.includes(fixture.expectedDiagnostic.code), fixture.expectedDiagnostic.code)
  for (const [code, count] of Object.entries(fixture.expectedDiagnostics ?? {})) assert.equal(codes.filter((row) => row === code).length, count, code)
  assertProjection(tree, fixture.expectedNodes ?? [])
  for (const projection of fixture.forbiddenNodes ?? []) assert.ok(!nodes(tree).some((node) => Object.entries(projection).every(([key, value]) => isDeepStrictEqual(field(node, key), value))), JSON.stringify(projection))
  for (const type of fixture.forbiddenTypes ?? []) assert.ok(!nodes(tree).some((node) => node.type === type), type)
})

test('shared acceptance cases have distinct identities and explicit assertions', () => {
  const ids = new Set()
  for (const row of [...fixtures.exportImport, ...fixtures.importNegative, ...fixtures.collisionExport, ...fixtures.markdownExportImport]) {
    assert.ok(!ids.has(row.id), row.id)
    ids.add(row.id)
    assert.ok(typeof row.source === 'string' || typeof row.html === 'string', row.id)
    assert.ok(row.expectedNodes?.length || row.attribute, row.id)
  }
})
