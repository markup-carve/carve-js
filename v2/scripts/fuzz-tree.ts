// Random single mutations of the trees of every example of the specification, through `decodeTree`. The only
// allowed outcomes are a refusal with a `CarveTreeError` whose path leads into the mutant (C2-A-167), or an
// accepted tree that `render` and `write` then take without throwing. Anything else is printed and fails.
//   node v2/scripts/fuzz-tree.ts [--count N] [--seed S] [--report N]
// A mutation picks one object or list anywhere in the tree, positions included, and then deletes a field, sets
// it to null, a number, a list, an object or a long string, adds an unknown field, swaps the type of a node, or
// nests a node in itself 300 levels deep. The same seed gives the same mutants.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CarveTreeError, decodeTree, encodeTree, parse, render, write } from '../src/index.ts'
import { NODE_TABLE } from '../src/ast-validate.ts'

function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 && at + 1 < process.argv.length ? process.argv[at + 1]! : fallback
}

type Json = null | boolean | number | string | Json[] | { [name: string]: Json }
type Container = Json[] | { [name: string]: Json }

const NEST_DEPTH = 300
const LONG_STRING = 'x'.repeat(1 << 16)
const TYPES = [...NODE_TABLE.RULES.keys(), 'rubyPair', 'escaped_text', 'unknown']
const COMMON = ['attrs', 'data', 'pos', 'segments', 'metadata', 'dir', 'lang']

/** The fields a node of `type` may carry (C2-A-050), so a mutation reaches past the check for unknown fields. */
function fieldsOf(type: Json): string[] {
  const rule = typeof type === 'string' ? NODE_TABLE.RULES.get(type) : undefined
  return rule === undefined ? COMMON : [...rule[1], ...rule[2], ...COMMON, 'children']
}

const DIGEST = `sha256:${'0'.repeat(64)}`
const TEXT = { type: 'text', value: 'a' }
const PARAGRAPH = { type: 'paragraph', children: [TEXT] }

// Supplied trees with the node types and fields that no example parses to, so the mutations reach them too.
const SEEDS: Json[] = [
  {
    type: 'document', astVersion: '2.0', resources: [{ id: 'r', mediaType: 'image/png', digest: DIGEST, href: 'a.png', size: 3 }],
    extensions: [{ name: 'org.example.x', required: false, version: '1' }], metadata: { a: { b: 1 } },
    children: [
      {
        type: 'block_extension', name: 'org.example.x', version: '1', props: { a: 1 }, slots: { s: [PARAGRAPH] },
        fallback: [PARAGRAPH], payload: [{ format: 'text/plain', value: 'p' }], resourceIds: ['r'], children: [PARAGRAPH],
      },
      {
        type: 'paragraph', data: { 'org.example': 1 }, children: [
          {
            type: 'inline_extension', name: 'x', payload: [{ format: 'application/json', value: { a: [1] } }], fallback: [TEXT],
            slots: { s: [TEXT] }, resourceIds: ['r'], children: [TEXT],
          },
          { type: 'ruby', pairs: [{ type: 'rubyPair', base: [TEXT], annotation: [TEXT] }] },
          { type: 'image', resourceId: 'r', alt: 'a', tooltip: 't' },
          { type: 'math', display: true, value: 'x', numberPrefix: 'Eq.', number: 1 },
          {
            type: 'citation_group', raw: '[@a]', mode: 'parenthetical', children: [
              {
                type: 'citation', key: 'a', namespace: 'citation', suppressAuthor: false, mode: 'parenthetical',
                prefix: [TEXT], locator: [TEXT], suffix: [TEXT],
              },
            ],
          },
          { type: 'link', key: 'k', namespace: 'link', form: 'full', href: '/u', children: [TEXT] },
          { type: 'xref', key: 'h', namespace: 'heading', href: '#h', form: 'title' },
        ],
      },
      { type: 'code_block', value: 'x\n', syntax: 'js', title: [{ type: 'emphasis', children: [TEXT] }], groupLabel: 'g' },
      { type: 'directive', kind: 'toc', tocTarget: 'headings', title: [TEXT], children: [] },
      { type: 'figure', kind: 'image', caption: { type: 'caption', short: [TEXT], children: [PARAGRAPH] }, children: [PARAGRAPH] },
      { type: 'include', path: "a'b.crv", section: 's', options: [['lines', '1-2'], ['code', '']] },
    ],
  },
  {
    astVersion: '2.1', extensions: [{ name: 'org.example.y', required: false }],
    document: { type: 'document', astVersion: '2.0', children: [PARAGRAPH] },
  },
]

/** A generator of 32-bit numbers (mulberry32), so a seed names its mutants. */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(next: () => number, list: readonly T[]): T {
  return list[Math.floor(next() * list.length)]!
}

function isContainer(value: Json): value is Container {
  return typeof value === 'object' && value !== null
}

/** Every object and list of `value`, the root included. */
function containers(value: Json, out: Container[]): Container[] {
  if (!isContainer(value)) return out
  out.push(value)
  for (const inner of Object.values(value)) containers(inner, out)
  return out
}

function replacement(next: () => number, node: Json, nodes: readonly Json[]): Json {
  const other = pick(next, nodes)
  const values: Json[] = [
    null, 7, -1, 1.5, 0, true, '', LONG_STRING, 'r', 'javascript:x', '2.0', 'html', [], [null], [{}], [7], ['r'], [node],
    [other], other, {}, { a: null }, { format: 'text/plain', value: null }, [{ format: 'x', value: 'y' }],
    [{ type: 'rubyPair', base: [other], annotation: [] }], [['k', 'v']], [['id', 'x']], { keyValues: [['k', 7]] },
  ]
  return pick(next, values)
}

/** Nests a copy of `node` in itself, 300 levels deep, through its children or a field that holds nodes. */
function nested(node: { [name: string]: Json }, field: string): Json {
  let inner: Json = structuredClone(node)
  for (let level = 0; level < NEST_DEPTH; level++) inner = { ...node, [field]: field === 'caption' ? inner : [inner] }
  return inner
}

function mutateList(next: () => number, target: Json[], nodes: readonly Json[]): string {
  if (target.length === 0 || next() < 0.2) {
    target.push(replacement(next, target[0] ?? null, nodes))
    return 'append to a list'
  }
  const at = Math.floor(next() * target.length)
  if (next() < 0.5) {
    target.splice(at, 1)
    return 'delete an entry'
  }
  target[at] = replacement(next, target[at]!, nodes)
  return 'replace an entry'
}

/** Mutates the object `target` in place and returns a description. */
function mutateObject(next: () => number, target: { [name: string]: Json }, nodes: readonly Json[]): string {
  const names = Object.keys(target)
  const choice = next()
  const node = typeof target['type'] === 'string'
  if (node && choice < 0.15) {
    target['type'] = pick(next, TYPES)
    return 'swap the type'
  }
  if (node && choice < 0.25) {
    const field = pick(next, ['children', 'children', 'fallback', 'title', 'caption'])
    const inner = nested(target, field)
    target[field] = field === 'caption' ? inner : [inner]
    return `nest in itself through ${field}`
  }
  if (names.length === 0 || choice < 0.45) {
    const field = next() < 0.1 ? 'unknownField' : pick(next, fieldsOf(target['type'] ?? null))
    target[field] = replacement(next, null, nodes)
    return `set ${field}`
  }
  const name = pick(next, names)
  if (choice < 0.6) {
    Reflect.deleteProperty(target, name)
    return `delete ${name}`
  }
  target[name] = replacement(next, target[name]!, nodes)
  return `replace ${name}`
}

/** Applies one mutation to a copy of `tree` and returns it with a description. `nodes` are nodes of any tree. */
function mutate(next: () => number, tree: Json, nodes: readonly Json[]): [Json, string] {
  const copy = structuredClone(tree)
  const all = containers(copy, [])
  const own = all.filter((value) => !Array.isArray(value) && typeof value['type'] === 'string')
  const target = pick(next, next() < 0.5 && own.length > 0 ? own : all)
  return [copy, Array.isArray(target) ? mutateList(next, target, nodes) : mutateObject(next, target, nodes)]
}

/** Whether every step of `path` but the last leads to a value of `tree`. */
function pathLeadsInto(tree: Json, path: string): boolean {
  if (path === '') return true
  const steps = path.split('/').slice(1).map((step) => step.replaceAll('~1', '/').replaceAll('~0', '~'))
  let value: Json = tree
  for (const step of steps.slice(0, -1)) {
    if (!isContainer(value)) return false
    value = (value as Record<string, Json>)[step] ?? null
  }
  return isContainer(value)
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message.split('\n')[0]!.slice(0, 200)}` : String(error)
}

interface Counts {
  mutants: number
  accepted: number
  refused: number
  bugs: string[]
}

function check(mutant: Json, what: string, counts: Counts): void {
  const json = JSON.stringify(mutant)
  let document
  try {
    document = decodeTree(json)
  } catch (error) {
    if (error instanceof CarveTreeError && pathLeadsInto(mutant, error.path)) {
      counts.refused++
      return
    }
    counts.bugs.push(`decode, ${what}: ${describeError(error)}\n    ${json.slice(0, 400)}`)
    return
  }
  counts.accepted++
  for (const [stage, run] of [['render', render], ['write', write]] as const) {
    try {
      run(document)
    } catch (error) {
      counts.bugs.push(`${stage} of an accepted tree, ${what}: ${describeError(error)}\n    ${json.slice(0, 400)}`)
    }
  }
}

if (process.argv[1] === import.meta.filename) {
  const count = Number(option('count', '200000'))
  const seed = Number(option('seed', '1'))
  const report = Number(option('report', '20'))
  const examples = JSON.parse(readFileSync(join(import.meta.dirname, '../data/examples.json'), 'utf8')) as { input: string }[]
  const treeOf = (src: string, positions: boolean): Json => JSON.parse(encodeTree(parse(src, { positions }))) as Json
  const parsed = examples.flatMap(({ input }) => [treeOf(input, true), treeOf(input, false)])
  for (const seed of SEEDS) decodeTree(JSON.stringify(seed))
  // The seeds hold the rare types, so they are taken as often as all examples together.
  const trees = [...parsed, ...Array.from({ length: parsed.length }, (_, at) => SEEDS[at % SEEDS.length]!)]
  const nodes = trees.flatMap((tree) => containers(tree, []).filter((value) => !Array.isArray(value) && typeof value['type'] === 'string'))
  const next = random(seed)
  const counts: Counts = { mutants: 0, accepted: 0, refused: 0, bugs: [] }
  const started = Date.now()
  for (; counts.mutants < count; counts.mutants++) {
    const [mutant, what] = mutate(next, pick(next, trees), nodes)
    check(mutant, what, counts)
  }
  console.log(`${counts.mutants} mutants of ${trees.length} trees (seed ${seed}): ${counts.refused} refused with a path, `
    + `${counts.accepted} accepted, ${counts.bugs.length} failures, ${Date.now() - started} ms`)
  for (const bug of counts.bugs.slice(0, report)) console.log(`  ${bug}`)
  process.exitCode = counts.bugs.length > 0 ? 1 : 0
}
