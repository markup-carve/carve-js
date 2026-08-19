/*
 * The import report against `spec/resources/html-import-schema.json`.
 *
 * The schema publishes the diagnostic code set, and this package re-publishes
 * the same set as `HtmlImportDiagnosticCode` for a consumer that switches over
 * it. Nothing joined the two before, so the enum was a constraint that could
 * not fail: a code could be added to either side alone, and a consumer's
 * exhaustive switch would go on compiling against a set the schema had already
 * left behind.
 *
 * `HtmlImportDiagnosticCode` is derived from `HTML_IMPORT_DIAGNOSTIC_CODES`,
 * so the array below IS the union rather than a second copy of it that could
 * drift. Comparing that array with the schema's `code` enum therefore
 * constrains the exported type, which is the thing a consumer switches over.
 * A hand-written union could not be checked this way at all: `tsc` does not
 * read the schema, and by the time a test runs the type is gone.
 *
 * This file also walks real reports through the schema, and is the only thing
 * in this package that reads the schema at all.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { HTML_IMPORT_DIAGNOSTIC_CODES } from '../src/html-import.js'
import { htmlToCarve } from '../src/index.js'

const SCHEMA_PATH = fileURLToPath(new URL('../spec/resources/html-import-schema.json', import.meta.url))
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as JsonSchema

interface JsonSchema {
  type?: string
  enum?: unknown[]
  required?: string[]
  additionalProperties?: boolean
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  minimum?: number
}

/**
 * The subset of draft 2020-12 this schema uses, and no more. Reaching for a
 * validator dependency to check one 27-line document would cost more than it
 * proves; leaving the document unread cost the enum its teeth.
 */
function violations(value: unknown, node: JsonSchema, path = '$'): string[] {
  const found: string[] = []
  if (node.enum && !node.enum.includes(value)) {
    found.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(node.enum)}`)
  }
  if (node.type === 'string' && typeof value !== 'string') found.push(`${path}: expected a string`)
  if (node.type === 'integer' && !Number.isInteger(value)) found.push(`${path}: expected an integer`)
  if (node.type === 'integer' && Number.isInteger(value) && node.minimum !== undefined && (value as number) < node.minimum) {
    found.push(`${path}: ${String(value)} is below the minimum ${node.minimum}`)
  }
  if (node.type === 'array') {
    if (!Array.isArray(value)) return [...found, `${path}: expected an array`]
    if (node.items) value.forEach((item, index) => found.push(...violations(item, node.items!, `${path}[${index}]`)))
  }
  if (node.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return [...found, `${path}: expected an object`]
    const record = value as Record<string, unknown>
    for (const key of node.required ?? []) {
      if (!(key in record)) found.push(`${path}: required property ${key} is missing`)
    }
    for (const [key, member] of Object.entries(record)) {
      const child = node.properties?.[key]
      if (!child) {
        if (node.additionalProperties === false) found.push(`${path}: unexpected property ${key}`)
        continue
      }
      found.push(...violations(member, child, `${path}.${key}`))
    }
  }
  return found
}

const schemaCodes = schema.properties!.diagnostics!.items!.properties!.code!.enum as string[]

describe('the HTML import report answers to the published schema', () => {
  it('publishes exactly the diagnostic codes the schema does', () => {
    // Sorted, because the two lists are sets and their orders are each
    // document's own business.
    expect([...HTML_IMPORT_DIAGNOSTIC_CODES].sort()).toEqual([...schemaCodes].sort())
  })

  it('carries the code the spec added for an encoding the source never declared', () => {
    // Named on its own rather than left to the set comparison above: that one
    // passes if BOTH sides drop `encoding-assumed`, and a code removed in
    // lockstep is exactly how a published contract quietly narrows.
    expect(schemaCodes).toContain('encoding-assumed')
    expect(HTML_IMPORT_DIAGNOSTIC_CODES).toContain('encoding-assumed')
  })

  it('validates the report an assumed encoding produces', () => {
    const result = htmlToCarve('<p>Alt <math alttext="a^2"><mrow><mi>a</mi></mrow></math>.</p>')
    expect(result.report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['encoding-assumed'])
    expect(violations(result.report, schema)).toEqual([])
  })

  it('validates the report a dropped `<colgroup>` produces', () => {
    // `element-dropped` was already in the enum, so this arm is not what could
    // have broken the contract - but a diagnostic nobody walks through the
    // schema is a diagnostic whose `path` and `severity` are unchecked against
    // it, and the walk is three lines.
    const result = htmlToCarve('<table><colgroup><col></colgroup><tr><td>a</td></tr></table>', { mode: 'semantic' })
    expect(result.report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['element-dropped'])
    expect(violations(result.report, schema)).toEqual([])
  })

  it('validates a report that exercises several arms at once', () => {
    const html = '<p onclick="evil()">safe<script>alert(1)</script></p>'
      + '<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>C</td></tr></tbody></table>'
      + '<p><math alttext="x"></math></p>'
    const result = htmlToCarve(html, { mode: 'semantic' })
    expect(result.report.diagnostics.length).toBeGreaterThan(1)
    expect(violations(result.report, schema)).toEqual([])
  })

  it('CONTROL: the validator reports a code the schema does not publish', () => {
    // Without this the three passes above are consistent with a validator that
    // returns an empty list for every input.
    const forged = { mode: 'safe', adapter: 'generic', diagnostics: [{ code: 'encoding-invented', message: 'x', severity: 'info' }] }
    expect(violations(forged, schema)).toEqual([
      '$.diagnostics[0].code: "encoding-invented" is not one of ' + JSON.stringify(schemaCodes),
    ])
  })

  it('CONTROL: the validator reports a property the schema does not allow', () => {
    const forged = { mode: 'safe', adapter: 'generic', diagnostics: [], extra: 1 }
    expect(violations(forged, schema)).toEqual(['$: unexpected property extra'])
  })

  it('CONTROL: the validator reports a required property that is missing', () => {
    const forged = { mode: 'safe', adapter: 'generic', diagnostics: [{ code: 'element-dropped', message: 'x' }] }
    expect(violations(forged, schema)).toEqual(['$.diagnostics[0]: required property severity is missing'])
  })
})
