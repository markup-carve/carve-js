// The conformance corpus of the pinned specification as the conformance gate of this engine
// (spec/0.2/conformance/README.md): every example, clause case, refused tree, positive tree and layout
// sidecar. The HTML import examples run in import/test/corpus.test.ts.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CLAUSE_CASES, CORPUS_EXAMPLES, DATA, EXAMPLE_TREES, LAYOUT_FIXTURES, REFUSED_TREES, SPEC_PIN, SUPPLIED_TREES, TREE_FILES,
} from '../scripts/corpus.ts'
import {
  clauseCaseMismatches, exampleMismatches, exampleTreeMismatches, layoutMismatches, type Mismatch, refusalPath,
} from '../scripts/corpus-checks.ts'
import { HELD, REFUSED_AT } from '../scripts/corpus-held.ts'
import { CORPUS_DIRECTORIES } from '../scripts/pin-spec.ts'
import { decodeTree } from '../src/index.ts'
import { newCaseMismatches } from '../scripts/corpus-new.mjs'

function fields(mismatches: readonly Mismatch[]): string[] {
  return mismatches.map((entry) => entry.field)
}

describe('the examples of the specification', () => {
  const carve = CORPUS_EXAMPLES.filter((example) => example.kind !== 'import')

  it('holds the 658 examples of the nine documents, 593 of them with a Carve input', () => {
    expect(CORPUS_EXAMPLES).toHaveLength(658)
    expect(carve).toHaveLength(593)
  })

  for (const example of carve) {
    const held = HELD.get(example.id)
    it(`${example.clauses[0] ?? ''}: ${example.id} (${example.kind}, ${example.status})`, () => {
      const mismatches = exampleMismatches(example)
      if (held === undefined) {
        expect(mismatches).toEqual([])
        return
      }
      // A held field that passes is a stale hold: the corpus was corrected, so the entry goes.
      expect(fields(mismatches), held.fix).toEqual(held.fields)
    })
  }

  it('every held example is an example of the corpus', () => {
    const ids = new Set([...carve, ...CLAUSE_CASES].map((entry) => entry.id))
    for (const id of HELD.keys()) expect(ids.has(id), id).toBe(true)
  })
})

describe('the clause cases of the specification', () => {
  it('holds 1385 cases, each with the sentence that decides it', () => {
    expect(CLAUSE_CASES).toHaveLength(1385)
    for (const entry of CLAUSE_CASES) expect(entry.why.length).toBeGreaterThan(0)
  })

  for (const entry of CLAUSE_CASES) {
    const held = HELD.get(entry.id)
    it(`${entry.clauses.join(', ')}: ${entry.id}, ${entry.summary}`, () => {
      const mismatches = entry.kind === undefined ? clauseCaseMismatches(entry) : newCaseMismatches(entry)
      expect(fields(mismatches), held?.fix).toEqual(held?.fields ?? [])
    })
  }
})

describe('the trees of the specification', () => {
  it('the reader refuses each of the 79 refused trees at the field its clause decides', () => {
    expect(REFUSED_TREES).toHaveLength(79)
    expect(new Set(REFUSED_TREES.map((entry) => entry.id))).toEqual(new Set(REFUSED_AT.keys()))
    for (const entry of REFUSED_TREES) {
      const path = refusalPath(entry)
      expect(path, `${entry.id} (${entry.clauses.join(', ')})`).not.toBeNull()
      expect(path?.startsWith(REFUSED_AT.get(entry.id) ?? '?'), `${entry.id}: refused at ${String(path)}`).toBe(true)
    }
  })

  for (const file of TREE_FILES) {
    const trees = EXAMPLE_TREES.get(file) ?? []
    it(`C2-A-161, C2-A-165: the ${trees.length} trees of trees/${file}.json are this engine's trees, positions included`, () => {
      const failures = trees.flatMap((entry) => {
        // A held tree field of the example is held in its tree file too.
        const held = HELD.get(entry.id)?.fields ?? []
        const found = fields(exampleTreeMismatches(entry)).filter((field) => !held.includes(field))
        return found.length === 0 ? [] : [[entry.id, found]]
      })
      expect(failures).toEqual([])
    })
  }

  it('C2-A-161: the reader accepts every supplied tree of trees/nodes.json', () => {
    for (const entry of SUPPLIED_TREES) expect(() => decodeTree(JSON.stringify(entry.tree)), entry.id).not.toThrow()
  })

  it('C2-L-007, C2-L-012, C2-L-056: each layout sidecar is accepted or refused as trees/layouts.json says, and is this engine\'s', () => {
    for (const entry of LAYOUT_FIXTURES) expect(fields(layoutMismatches(entry)), entry.id).toEqual([])
  })
})

const spec = join(process.env['CARVE_SPEC_DIR'] ?? join(import.meta.dirname, '..', 'spec'), 'spec/0.2')

it(
  `data/ holds the corpus and the trees of the specification at ${SPEC_PIN.slice(0, 8)}`,
  () => {
    for (const directory of CORPUS_DIRECTORIES) {
      const names = ['examples.json', 'clause-cases.json', 'refused-trees.json', 'schema.json']
      const files = directory === 'conformance' ? names : TREE_FILES.map((file) => `${file}.json`).concat(['nodes.json', 'refused.json', 'layouts.json'])
      for (const name of files) {
        expect(readFileSync(join(DATA, directory, name), 'utf8'), `${directory}/${name}`).toBe(readFileSync(join(spec, directory, name), 'utf8'))
      }
    }
  },
)
