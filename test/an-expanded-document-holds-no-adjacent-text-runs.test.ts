/*
 * PART 12 §1a on the EXPANDED tree, which `toAstJson` publishes without going
 * through `resolve()`. The vector rows feed every virtual include-conformance
 * document to the check (carve-js#1734).
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve as resolvePath, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../src/parse.js'
import { expandIncludes } from '../src/includes.js'
import { toAstJson } from '../src/ast-json.js'

const CHILD_FIELDS = ['children', 'items', 'rows', 'cells', 'inline', 'content', 'caption', 'title']

/** Every path where a node's child list holds two adjacent `text` nodes. */
function adjacentTextRuns(node: unknown, path = '$'): string[] {
  if (!node || typeof node !== 'object') return []
  const out: string[] = []
  const record = node as Record<string, unknown>
  for (const field of CHILD_FIELDS) {
    const value = record[field]
    if (!Array.isArray(value)) continue
    for (let i = 1; i < value.length; i++) {
      const left = value[i - 1] as Record<string, unknown> | null
      const right = value[i] as Record<string, unknown> | null
      if (left?.['type'] === 'text' && right?.['type'] === 'text') {
        out.push(`${path}.${field}[${i - 1}..${i}]`)
      }
    }
    value.forEach((child, i) => out.push(...adjacentTextRuns(child, `${path}.${field}[${i}]`)))
  }
  return out
}

describe('an expanded document holds no adjacent text runs', () => {
  it('merges an inline include into the surrounding run', () => {
    const entry = 'Root {{ sub/child.crv }} tail.\n'
    const doc = parse(entry, { positions: true })
    const result = expandIncludes(doc, entry, {
      resolve: (path) =>
        path === 'sub/child.crv' ? { source: 'inlined text\n', id: path } : null,
    })
    const json = toAstJson(result.doc) as unknown as Record<string, unknown>

    expect(adjacentTextRuns(json)).toEqual([])
    const paragraph = (json['children'] as Array<Record<string, unknown>>)[0]!
    expect(paragraph['children']).toMatchObject([{ type: 'text', value: 'Root inlined text tail.' }])
  })

  const vectorDir = resolvePath(
    dirname(fileURLToPath(import.meta.url)),
    '../spec/tests/include-conformance/vectors',
  )
  const vectors = readdirSync(vectorDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(vectorDir, f), 'utf8')) as Record<string, unknown>)
    .filter((v) => v['mode'] !== 'filesystem' && typeof v['entry'] === 'string')

  it('vendors the virtual vectors this gate walks', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(80)
  })

  for (const vector of vectors) {
    it(`${vector['name']}`, () => {
      const entry = vector['entry'] as string
      const files = (vector['files'] ?? {}) as Record<string, string>
      const options = (vector['options'] ?? {}) as Record<string, unknown>
      const expandArgs: Record<string, unknown> = {}
      for (const key of ['sourcePath', 'maxDepth', 'maxBytes']) {
        if (options[key] !== undefined) expandArgs[key] = options[key]
      }
      if (vector['resolver'] !== 'none' && options['resolverThrows'] === undefined) {
        expandArgs['resolve'] = options['resolverIds']
          ? (p: string) => {
              const id = p.replace(/^\.\//, '')
              return files[id] === undefined ? null : { source: files[id]!, id }
            }
          : (p: string) => (files[p] === undefined ? null : files[p]!)
      }
      const doc = parse(entry, { positions: true })
      const result = expandIncludes(doc, entry, expandArgs)
      expect(adjacentTextRuns(toAstJson(result.doc))).toEqual([])
    })
  }
})
