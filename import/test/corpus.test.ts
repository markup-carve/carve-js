// The HTML import examples of the conformance corpus that the engine pins (v2/data/conformance/examples.json):
// the children of the imported document without positions, the canonical source, and the codes the example names.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { describe, expect, it } from 'vitest'
import { encodeTree } from '../../v2/src/index.ts'
import { importDocument } from '../src/index.ts'

interface ImportExample {
  id: string
  kind: string
  clauses: string[]
  status: string
  html?: string
  options: { rawHtml?: boolean }
  expected: { children?: unknown[], carve?: string, diagnostics?: string[] }
}

const path = join(import.meta.dirname, '../../v2/data/conformance/examples.json')
const examples = (JSON.parse(readFileSync(path, 'utf8')) as { examples: ImportExample[] }).examples.filter(entry => entry.kind === 'import')

/**
 * The fields of the examples whose stated result departs from its own clause, written up with the clause-correct
 * result in _EXAMPLE_FIXES.md. A held field must keep failing until the corpus is corrected.
 */
const HELD: ReadonlyMap<string, { fields: readonly string[], fix: string }> = new Map([])

function mismatches(example: ImportExample): string[] {
  const result = importDocument(example.html ?? '', { from: 'html', ...example.options })
  const tree = JSON.parse(encodeTree(result.document), (key, value: unknown) => key === 'pos' ? undefined : value) as { children: unknown }
  const expected = example.expected
  const out: string[] = []
  if (!isDeepStrictEqual(tree.children, expected.children)) out.push('children')
  if (expected.carve !== undefined && result.source !== expected.carve) out.push('carve')
  const reported = result.diagnostics.map(entry => entry.code)
  // The codes the text says are reported; the list need not be complete.
  if ((expected.diagnostics ?? []).some(code => !reported.includes(code))) out.push('diagnostics')
  return out
}

describe('the HTML import examples of the specification', () => {
  it('holds the 48 examples of import-html.md', () => {
    expect(examples).toHaveLength(48)
  })

  for (const example of examples) {
    const held = HELD.get(example.id)
    it(`${example.clauses[0] ?? ''}: ${example.id} (${example.status})`, () => {
      expect(mismatches(example), held?.fix).toEqual(held?.fields ?? [])
    })
  }

  it('C2-M-081: every entry of an import carries a foreignType and a byte range', () => {
    for (const example of examples) {
      for (const entry of importDocument(example.html ?? '', { from: 'html', ...example.options }).diagnostics) {
        expect(entry.foreignType, `${example.id} ${entry.code}`).toBeTypeOf('string')
        expect(entry.range, `${example.id} ${entry.code}`).toBeDefined()
      }
    }
  })
})
