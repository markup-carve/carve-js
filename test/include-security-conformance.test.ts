/*
 * Include-security conformance adapter (PART 9 section 19).
 *
 * The processor-neutral security corpus lives in the spec submodule at
 * spec/tests/include-security-conformance/. carve-js drives the include
 * LANGUAGE corpus in include-conformance.test.ts but carried no runner for
 * this one, so none of its vectors was answered here and every section 19
 * bound was implemented but ungated (carve-js#1682).
 *
 * Modelled on carve-lsp's adapter (carve-lsp#198). Five SETS are pinned rather
 * than counted: the vector count, the requirement ids, the vector members this
 * adapter reads, the expected observables it produces, and the denial classes
 * it answers. An unknown kind, requirement, member or observable FAILS - it
 * must not fall through to a branch that happens to answer something.
 *
 * Two observables are weaker here than in carve-lsp, because this engine
 * exposes less; both are called out at their site:
 *
 * - `denial` for a filesystem refusal. carve-js's resolver refuses with `null`
 *   and carries no denial vocabulary, so the class is recovered by asking the
 *   ENGINE a second question - see {@link classifyRefusal}.
 * - `chargedBytes`. The expander's running total is internal, so it is summed
 *   from the sources the resolver actually handed back. That is the same
 *   quantity the corpus names, and it is decided entirely by WHICH targets the
 *   engine chose to resolve, which is the section 19 property under test.
 */
import { afterAll, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expandIncludes, parse, type IncludeContext, type IncludeResolver } from '../src/index.js'
import { fileSystemResolver } from '../src/includes-fs.js'

const KINDS = ['activation', 'filesystem', 'remote', 'graph'] as const
type Kind = (typeof KINDS)[number]

interface Vector {
  name: string
  description?: string
  requirement: string
  kind: Kind
  entry?: string
  files?: Record<string, string>
  tree?: Record<string, string | { symlink: string }>
  root?: string
  rootSpec?: string
  from?: string
  request?: string
  trusted?: boolean
  enabled?: boolean
  allowAbsolute?: boolean
  allowedRemoteHosts?: string[]
  maxDepth?: number
  maxBytes?: number
  maxResolverCalls?: number
  expected: Record<string, unknown>
}

/**
 * Every member this adapter knows how to honor.
 *
 * A vector member nothing reads is the failure this list exists to stop, and
 * it is not hypothetical: in carve-lsp, renaming `rootSpec` on one vector left
 * that vector's own rows PASSING, because `root` then defaulted to a directory
 * that happened to be named right. Only the member pin went red.
 *
 * `trusted` is read by the corpus author, not here: the activation vector
 * states both the trust it describes and the `enabled` a host derives from it,
 * and this adapter drives the latter.
 *
 * `root` and `rootSpec` are not two spellings of one member - see
 * {@link resolverFor} - and the corpus schema refuses both on one vector.
 */
const KNOWN_VECTOR_KEYS: ReadonlySet<string> = new Set([
  'name',
  'description',
  'requirement',
  'kind',
  'entry',
  'files',
  'tree',
  'root',
  'rootSpec',
  'from',
  'request',
  'trusted',
  'enabled',
  'allowAbsolute',
  'allowedRemoteHosts',
  'maxDepth',
  'maxBytes',
  'maxResolverCalls',
  'expected',
])

/**
 * Every field an `expected` block may carry. Without this pin an observable
 * nobody implemented is only ever compared against `undefined`, which reds one
 * vector's row instead of naming the gap.
 */
const KNOWN_EXPECTED_KEYS: ReadonlySet<string> = new Set([
  'status',
  'denial',
  'canonicalId',
  'resolverCalls',
  'remoteFetches',
  'maxVisitedDepth',
  'chargedBytes',
])

/**
 * The requirement ids this adapter answers, as a SET rather than a count, so a
 * corpus that grows a new requirement NAMES the unanswered one.
 */
const PINNED_REQUIREMENTS = [
  'S1-opt-in',
  'S2-contained-paths',
  'S3-remote-allowlist',
  'S4-depth-bound',
  'S5-byte-bound',
  'S6-post-budget-no-read',
  'S7-call-bound',
  'S8-post-call-bound-no-read',
  'S9-root-configuration',
]

/**
 * Every portable denial class the corpus asserts, pinned as a SET so a new one
 * names itself here instead of surfacing as one vector's mismatched string.
 */
const PINNED_DENIAL_CLASSES = [
  'budget',
  'depth',
  'no-root',
  'not-found',
  'outside-root',
  'remote-not-allowed',
  'resolver-calls',
]

/**
 * Warning rule ids that are a section 19 whole-walk refusal, mapped to the
 * corpus's portable class. `include-unresolved` is NOT one of them: the
 * call-bound vectors are built entirely out of unresolvable targets, so
 * reading an unresolved target as a refusal would answer them from the wrong
 * evidence.
 */
const DENIAL_BY_RULE: Record<string, string> = {
  'include-depth': 'depth',
  'include-budget': 'budget',
  'include-call-limit': 'resolver-calls',
}

const here = dirname(fileURLToPath(import.meta.url))
const corpusPath = resolvePath(here, '../spec/tests/include-security-conformance/vectors.json')

if (!existsSync(corpusPath)) {
  throw new Error(
    `Include-security vectors not found at ${corpusPath}.\n` +
      `Did you initialize the submodule?\n` +
      `  git submodule update --init --recursive`,
  )
}

const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as {
  version: number
  vectors: Vector[]
}

const fixtures: string[] = []
afterAll(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true })
})

function fixture(tree: Vector['tree']): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'carve-js-include-security-')))
  fixtures.push(dir)
  const links: Array<[string, string]> = []
  for (const [name, value] of Object.entries(tree ?? {})) {
    const full = path.join(dir, name)
    mkdirSync(path.dirname(full), { recursive: true })
    if (typeof value === 'string') writeFileSync(full, value)
    else links.push([full, value.symlink])
  }
  for (const [full, target] of links) symlinkSync(path.join(dir, target), full)

  return dir
}

/** `<ABS:path>` denotes the temporary tree's absolute path to `path`. */
function materialize(value: string, dir: string): string {
  return value.replace(/^<ABS:([^>]+)>$/, (_match, rel: string) => path.join(dir, rel))
}

/**
 * The resolver a filesystem vector runs against, and the two ways a vector may
 * name its containment root. They are not interchangeable.
 *
 * `root` is the ADAPTER's: canonicalized here, so containment is the only
 * question left for the engine.
 *
 * `rootSpec` is the HOST's CONFIGURED value, and what the engine's own
 * configuration seam does with it is the behavior under test. carve-js's seam
 * is `fileSystemResolver` itself, which refuses a blank root by throwing, so
 * the spec is handed over UNCHANGED - expanding `<ABS:>` is the corpus
 * spelling out its temporary tree, not a canonicalization. Canonicalizing it
 * here first would answer the vector with the adapter's own `realpathSync`,
 * and `realpathSync('')` is the process working directory: the one root
 * section 19 forbids by name. The vector would then test nothing.
 */
function resolverFor(
  vector: Vector,
  dir: string,
): { resolver: IncludeResolver; rootReal: string } | { resolver?: undefined } {
  if (vector.root !== undefined && vector.rootSpec !== undefined) {
    throw new Error(`vector names a root two ways: ${vector.name}`)
  }
  const opts = vector.allowAbsolute === undefined ? {} : { allowAbsolute: vector.allowAbsolute }
  if (vector.rootSpec === undefined) {
    const rootReal = realpathSync(path.join(dir, vector.root ?? 'root'))

    return { resolver: fileSystemResolver(rootReal, opts), rootReal }
  }
  const spec = materialize(vector.rootSpec, dir)
  let resolver: IncludeResolver
  try {
    resolver = fileSystemResolver(spec, opts)
  } catch {
    return {}
  }

  return { resolver, rootReal: realpathSync(spec) }
}

/**
 * The portable class for a filesystem refusal.
 *
 * carve-js's resolver answers every refusal with `null` and publishes no
 * denial vocabulary, so the class cannot be read off the engine's answer. It
 * is recovered by asking the ENGINE a SECOND question instead of re-deriving
 * its path math here: put the target in place and ask again. A refusal that
 * was only "this target is missing" turns into an allow; a refusal that is
 * containment refuses the same request again.
 *
 * The one piece of path math left is where to put the probe file, and a wrong
 * answer there is LOUD rather than silent: the probe lands somewhere the
 * request does not name, the engine refuses again, and the vector reds with
 * `outside-root`. The probe never leaves the fixture directory.
 */
function classifyRefusal(
  resolver: IncludeResolver,
  request: string,
  ctx: IncludeContext,
  rootReal: string,
  dir: string,
): string {
  const parent = ctx.stack[ctx.stack.length - 1]
  const base = parent ? path.dirname(path.resolve(rootReal, parent)) : rootReal
  const candidate = path.isAbsolute(request) ? request : path.resolve(base, request)
  // The target is already there and the engine still refused it, so the
  // refusal is not about existence.
  if (existsSync(candidate)) return 'outside-root'
  if (path.relative(dir, candidate).startsWith('..')) return 'outside-root'
  mkdirSync(path.dirname(candidate), { recursive: true })
  writeFileSync(candidate, 'probe\n')

  return resolver(request, ctx) === null ? 'outside-root' : 'not-found'
}

function canonicalIdOf(resolved: NonNullable<ReturnType<IncludeResolver>>): string {
  return typeof resolved === 'string' ? '' : (resolved.id ?? '')
}

function graph(vector: Vector): Record<string, unknown> {
  const calls: string[] = []
  let maxVisitedDepth = 0
  const resolve: IncludeResolver = (request, ctx) => {
    calls.push(request)
    maxVisitedDepth = Math.max(maxVisitedDepth, ctx.depth + 1)
    const source = vector.files?.[request]
    if (source === undefined) return null

    return { source, id: request }
  }
  const entry = vector.entry ?? ''
  const result = expandIncludes(parse(entry), entry, {
    resolve,
    ...(vector.maxDepth === undefined ? {} : { maxDepth: vector.maxDepth }),
    ...(vector.maxBytes === undefined ? {} : { maxBytes: vector.maxBytes }),
    ...(vector.maxResolverCalls === undefined
      ? {}
      : { maxResolverCalls: vector.maxResolverCalls }),
  })
  // The FIRST whole-walk refusal, which is the one that latched: every later
  // directive reports the same rule without being resolved.
  const warning = result.warnings.find((item) => item.rule in DENIAL_BY_RULE)

  return {
    resolverCalls: calls,
    maxVisitedDepth,
    // THE ENGINE'S OWN TOTAL, not a tally kept here. Summing what this
    // resolver handed over answers `chargedBytes` from the adapter's side of
    // the seam, so it reads 12/12/5 whatever the engine charges - and it did,
    // while the engine was charging 7/8/0. A vector that cannot see the
    // engine's accounting cannot pin it (carve-js#1699).
    chargedBytes: result.chargedBytes,
    status: warning ? 'denied' : 'allowed',
    ...(warning === undefined ? {} : { denial: DENIAL_BY_RULE[warning.rule] }),
  }
}

function activation(vector: Vector): Record<string, unknown> {
  const calls: string[] = []
  const resolve: IncludeResolver = (request) => {
    calls.push(request)

    return null
  }
  const entry = vector.entry ?? ''
  expandIncludes(parse(entry), entry, vector.enabled ? { resolve } : {})

  return { resolverCalls: calls }
}

function run(vector: Vector): Record<string, unknown> {
  // An unknown kind used to fall through to the filesystem branch in the
  // adapter this one is modelled on, which materialized no tree, resolved an
  // empty request and answered `denied` - a PASS, for a vector nothing had
  // implemented.
  if (!KINDS.includes(vector.kind)) throw new Error(`unknown vector kind: ${String(vector.kind)}`)
  if (vector.kind === 'activation') return activation(vector)
  if (vector.kind === 'graph') return graph(vector)

  const dir = fixture(vector.tree ?? { 'root/main.crv': '' })
  const configured = resolverFor(vector, dir)
  // No root, no resolver, and no include pass behind it: the target is not
  // resolved even though it exists and sits inside the root the vector
  // INTENDED. `resolverCalls` is the observable that separates this from a
  // resolver that looked and refused.
  if (configured.resolver === undefined) {
    return { status: 'denied', denial: 'no-root', resolverCalls: [] }
  }
  const { resolver, rootReal } = configured
  const request = materialize(vector.request ?? '', dir)
  const ctx: IncludeContext = vector.from
    ? { stack: [realpathSync(path.join(dir, vector.from))], depth: 0 }
    : { stack: [], depth: 0 }
  const result = resolver(request, ctx)

  if (vector.kind === 'remote') {
    // carve-js ships no remote resolver and no host allowlist: the filesystem
    // resolver is the only one in the package and it reads files. So an
    // allowlist cannot turn a URL into a fetch here, which is exactly the
    // `unsupported` answer the corpus allows; without one the refusal IS the
    // prohibition. `remoteFetches` is empty because the include path performs
    // no network I/O at all - pinned structurally by its own test below.
    const allowlisted = (vector.allowedRemoteHosts?.length ?? 0) > 0

    return {
      status: result !== null ? 'allowed' : allowlisted ? 'unsupported' : 'denied',
      ...(result !== null || allowlisted ? {} : { denial: 'remote-not-allowed' }),
      remoteFetches: [],
    }
  }

  return result !== null
    ? { status: 'allowed', canonicalId: canonicalIdOf(result).replace(rootReal, '<ROOT>') }
    : { status: 'denied', denial: classifyRefusal(resolver, request, ctx, rootReal, dir) }
}

describe('the include-security corpus is answered as a contract, not a bag of fields', () => {
  it('pins the corpus version', () => {
    expect(corpus.version).toBe(1)
  })

  it('pins the vector count, so an addition cannot be skipped unnoticed', () => {
    expect(corpus.vectors.length).toBe(23)
  })

  it('answers every requirement the corpus states', () => {
    const stated = [...new Set(corpus.vectors.map((vector) => vector.requirement))].sort()
    expect(stated).toEqual([...PINNED_REQUIREMENTS].sort())
  })

  it('answers every denial class the corpus asserts', () => {
    const stated = [
      ...new Set(
        corpus.vectors.flatMap((vector) =>
          typeof vector.expected['denial'] === 'string' ? [vector.expected['denial']] : [],
        ),
      ),
    ].sort()
    expect(stated).toEqual([...PINNED_DENIAL_CLASSES].sort())
  })

  it('produces every observable the corpus expects', () => {
    const unknown = [
      ...new Set(corpus.vectors.flatMap((vector) => Object.keys(vector.expected))),
    ]
      .filter((key) => !KNOWN_EXPECTED_KEYS.has(key))
      .sort()
    expect(unknown).toEqual([])
  })

  it('reads every member the corpus puts on a vector', () => {
    const unread = [...new Set(corpus.vectors.flatMap((vector) => Object.keys(vector)))]
      .filter((key) => !KNOWN_VECTOR_KEYS.has(key))
      .sort()
    expect(unread).toEqual([])
  })

  it('drives every kind the corpus uses', () => {
    const stated = [...new Set(corpus.vectors.map((vector) => vector.kind))].sort()
    expect(stated.filter((kind) => !KINDS.includes(kind))).toEqual([])
  })

  /**
   * What makes the empty `remoteFetches` a fact rather than a hardcoded
   * answer: the include path has no way to reach the network.
   */
  it('performs no network I/O anywhere in the include path', () => {
    const modules = ['../src/includes.ts', '../src/includes-fs.ts', '../src/include-directive.ts']
    for (const module of modules) {
      const source = readFileSync(resolvePath(here, module), 'utf8')
      expect(source).not.toMatch(/\bnode:(https?|net|dgram|tls)\b/)
      expect(source).not.toMatch(/\bfetch\s*\(/)
      expect(source).not.toMatch(/\bXMLHttpRequest\b/)
    }
  })
})

/**
 * One test per (vector, expected field), so a failure names the observable that
 * moved rather than the first one checked. The call-bound vectors can fail
 * three different ways - an extra `resolverCalls` entry, a `budget` denial
 * where `resolver-calls` belongs, a `chargedBytes` that never engaged - and
 * collapsing them into one assertion hides two of the three.
 */
const observed = new Map<string, Record<string, unknown>>()

function actualFor(vector: Vector): Record<string, unknown> {
  const cached = observed.get(vector.name)
  if (cached !== undefined) return cached
  const value = run(vector)
  observed.set(vector.name, value)

  return value
}

describe('PART 9 section 19 include-security vectors', () => {
  for (const vector of corpus.vectors) {
    for (const [field, expected] of Object.entries(vector.expected)) {
      it(`${vector.requirement} ${vector.name}: ${field}`, () => {
        expect(actualFor(vector)[field]).toEqual(expected)
      })
    }
  }
})
