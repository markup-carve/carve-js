// Candidate 13 case kinds and their stated fields (spec/0.2/conformance/README.md).
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'
import * as engine from '../src/index.ts'
import { imgFenceExtensions, imgFenceRenderers } from '../extensions/blocks/img-fence.ts'
import { mermaid } from '../src/extensions/standard/fenced-render.ts'
import { codeGroup } from '../src/extensions/standard/code-group.ts'
import { importDocument } from '../import/src/index.ts'
import { CATALOG } from '../lint/catalog.ts'
import { corpusResolver, hexBytes } from './corpus.ts'
import { withoutPositions } from './corpus-checks.ts'
import { applyPatch, diffTree, sourceFingerprint, treeFingerprint } from '../src/tree-patch.ts'

const same = (a, b) => isDeepStrictEqual(a, b)
const standardRenderers = { ...imgFenceRenderers, ...mermaid().renderers, ...codeGroup().renderers }
const catalogRows = Object.freeze(JSON.parse(readFileSync(new URL('../data/lint-rules.json', import.meta.url), 'utf8')).rules)
const parseRows = Object.freeze(Object.fromEntries(catalogRows.filter(row => row.channel !== 'lint').map(row => [row.id, row])))
const plain = value => JSON.parse(JSON.stringify(value))
const inputOf = entry => entry.inputBytes === undefined ? entry.input : hexBytes(entry.inputBytes)
const decoded = input => typeof input === 'string' ? input : new TextDecoder().decode(input)

function optionsOf(entry) {
  const options = { ...entry.options }
  const extensions = options.extensions ?? []
  if (extensions.length > 0) options.extensions = [
    ...(extensions.includes('carve.tabs') ? engine.tabsExtensions : []),
    ...(extensions.includes('carve.wiki') ? [engine.wikiExtension] : []),
    ...(extensions.includes('carve.cite') ? [engine.citeExtension] : []),
    ...(extensions.includes('carve.imgFence.img') ? imgFenceExtensions : []),
    ...(extensions.includes('carve.fencedRender.mermaid') ? mermaid().extensions : []),
    ...(extensions.includes('carve.codeGroup') ? codeGroup().extensions : []),
    ...(extensions.includes('carve.details') ? [engine.detailsExtension] : []),
    ...(extensions.includes('carve.spoiler') ? [engine.spoilerExtension] : []),
    ...(extensions.includes('carve.spoilerBlock') ? [engine.spoilerBlockExtension] : []),
  ]
  if (options.renderers !== undefined) options.renderers = Object.fromEntries(Object.entries(options.renderers).map(([name, value]) =>
    [name, name === 'carve.tabs' && typeof value === 'object' && value?.standard
      ? engine.standardTabsRenderer(value.standard)
      : value === 'standard' ? name === 'carve.tabs' ? engine.tabsRenderer : standardRenderers[name] : value]))
  if (entry.files !== undefined) options.includes = { resolver: corpusResolver(entry.files), ...options.includes }
  if (options.codeBlockRenderer !== undefined) options.codeBlockRenderer = codeBlockFunction(options.codeBlockRenderer)
  return options
}

// conformance/README.md: the harness spelling of codeBlockRenderer (C2-H-206).
function codeBlockFunction({ syntax, result }) {
  return (node, defaultHtml) => {
    if (syntax !== undefined && node.syntax !== syntax) return undefined
    if (typeof result !== 'string') return result === null ? undefined : result
    return result.replace(/\{default\}|\{syntax\}/g, (field) => field === '{default}' ? defaultHtml : node.syntax ?? '')
  }
}

function documentTransforms(entry) {
  return (entry.host?.documentTransforms ?? []).map((row) => ({ name: row.name, transform(view) {
    const path = row.after.split('/').slice(1).map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    const at = Number(path.pop())
    let parent = view
    for (const part of path) parent = parent[part]
    const inserted = structuredClone(row.insert)
    // C2-A-058: a host fixture's empty slot map constructs an absent slot field in the actual tree.
    if (inserted.slots && Object.keys(inserted.slots).length === 0) delete inserted.slots
    parent.splice(at + 1, 0, inserted)
    return view
  } }))
}

function parseOptions(options) {
  return Object.fromEntries(Object.entries(options).filter(([key]) => ['includes', 'extensions', 'headingIds', 'positions'].includes(key)))
}

function point(source, offset) {
  const bytes = typeof source === 'string' ? Buffer.from(source) : source
  const prefix = new TextDecoder().decode(bytes.subarray(0, offset))
  const lines = prefix.split('\n')
  return { line: lines.length, column: Array.from(lines.at(-1) ?? '').length + 1 }
}

function templateMatches(template, message) {
  const expression = template.split(/\$\{[^}]+\}/).map(piece => piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp(`^${expression}$`, 's').test(message)
}

function diagnosticMatches(actual, expected, source, files) {
  if (actual.code !== expected.code) return false
  for (const name of ['severity', 'channel', 'path', 'file']) {
    if (expected[name] !== undefined && actual[name] !== expected[name]) return false
  }
  const counted = actual.file === undefined ? source : files?.[actual.file]?.text
  if (actual.range !== undefined && counted !== undefined) {
    const start = point(counted, actual.range.startOffset)
    const end = point(counted, actual.range.endOffset)
    const places = { line: start.line, column: start.column, endLine: end.line, endColumn: end.column }
    for (const [name, value] of Object.entries(places)) {
      if (expected[name] !== undefined && expected[name] !== value) return false
    }
  } else if (['line', 'column', 'endLine', 'endColumn'].some(name => expected[name] !== undefined)) return false
  if (expected.messageWhen !== undefined) {
    const row = CATALOG[actual.code]
    if (row !== undefined) {
      const index = row.conditions.indexOf(expected.messageWhen)
      if (index < 0 || !templateMatches(row.messages[index], actual.message)) return false
    } else {
      const variant = parseRows[actual.code]?.messages.find(message => message.when === expected.messageWhen)
      if (variant === undefined || !templateMatches(variant.text, actual.message)) return false
    }
  }
  return true
}

function diagnosticFields(actual, expected, source, files) {
  const out = []
  for (const item of expected.diagnostics ?? []) {
    const wanted = typeof item === 'string' ? { code: item } : item
    if (!actual.some(found => diagnosticMatches(found, wanted, source, files))) out.push(`diagnostics:${wanted.code}`)
  }
  for (const code of expected.notReported ?? []) if (actual.some(found => found.code === code)) out.push(`notReported:${code}`)
  if (expected.diagnosticsComplete && actual.length !== (expected.diagnostics ?? []).length) out.push('diagnosticsComplete')
  return out
}

function childrenFields(document, expected) {
  if (expected.children === undefined) return []
  const actual = plain(document).children
  const shaped = { type: 'document', astVersion: '2.0', children: expected.children }
  return same(actual, expected.children) || same(withoutPositions(actual), expected.children)
    || engine.treesEqual(document, shaped) ? [] : ['children']
}

function treeFields(document, expected) {
  return expected.tree === undefined || same(plain(document), expected.tree) || engine.treesEqual(document, expected.tree) ? [] : ['tree']
}

function layoutFields(actual, expected) {
  const out = []
  for (const [key, value] of Object.entries(expected.layout ?? {})) {
    if (key !== 'nodes') { if (!same(actual[key], value)) out.push('layout'); continue }
    for (const node of value) {
      const found = actual.nodes.find(entry => entry.path === node.path)
      if (!found || Object.entries(node).some(([name, fact]) => !same(found[name], fact))) out.push('layout')
    }
  }
  for (const [path, names] of Object.entries(expected.layoutAbsent ?? {})) {
    const found = actual.nodes.find(entry => entry.path === path)
    if (names.some(name => found && name in found)) out.push('layoutAbsent')
  }
  return out
}

function cliFields(entry) {
  const dir = mkdtempSync(join(tmpdir(), 'carve-corpus-'))
  const out = []
  try {
    for (const [name, content] of Object.entries(entry.files ?? {})) {
      const path = join(dir, name)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, typeof content === 'string' ? content : content.text ?? hexBytes(content.bytes))
    }
    const main = join(import.meta.dirname, '../cli/main.ts')
    const result = spawnSync(process.execPath, [main, ...entry.args],
      { cwd: dir, input: entry.stdin ?? '', encoding: 'utf8', maxBuffer: 20_000_000 })
    const expected = entry.expected
    if (result.status !== expected.status) out.push('status')
    if (expected.stdout !== undefined && result.stdout !== expected.stdout) out.push('stdout')
    if (expected.stdoutJson !== undefined) {
      try { if (!same(JSON.parse(result.stdout), expected.stdoutJson)) out.push('stdoutJson') }
      catch { out.push('stdoutJson') }
    }
    const category = result.stderr.match(/^carve\[([^\]]+)\]:/)?.[1] ?? null
    if (expected.stderrCategory !== undefined && category !== expected.stderrCategory) out.push('stderrCategory')
    for (const [field, output] of [['stdoutDiagnostics', result.stdout], ['stderrDiagnostics', result.stderr]]) {
      if (expected[field] === undefined) continue
      const found = output.split('\n').flatMap((line) => {
        const match = /^(.+):(\d+):(\d+): (error|warning|hint) ([\w/-]+) /.exec(line)
        if (match !== null) return [{ file: match[1], line: Number(match[2]), column: Number(match[3]),
          severity: match[4], code: match[5] }]
        const unplaced = /^(.+): (error|warning|hint) ([\w/-]+) /.exec(line)
        return unplaced === null ? [] : [{ file: unplaced[1], severity: unplaced[2], code: unplaced[3] }]
      })
      const wanted = expected[field]
      if (!wanted.every(item => found.some(actual => Object.entries(item).every(([name, value]) => same(actual[name], value))))) {
        out.push(field)
      }
    }
    for (const [name, content] of Object.entries(expected.filesAfter ?? {})) {
      const path = join(dir, name)
      if (content === null) { if (existsSync(path)) out.push('filesAfter'); continue }
      try {
        const value = readFileSync(path, 'utf8')
        if (content.text !== undefined && value !== content.text) out.push('filesAfter')
        if (content.json !== undefined && !same(JSON.parse(value), content.json)) out.push('filesAfter')
      } catch { out.push('filesAfter') }
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
  return out
}

function run(entry) {
  const kind = entry.kind
  if (kind === 'cli') return cliFields(entry)
  const expected = entry.expected
  const options = optionsOf(entry)
  const input = inputOf(entry)
  if (kind === 'tree') {
    const document = engine.decodeTree(entry.json ?? JSON.stringify(entry.tree), undefined, options.extensions)
    return [...treeFields(document, expected), ...(expected.accepted === false ? ['accepted'] : [])]
  }
  if (kind === 'migrate') {
    const result = engine.migrateTree(entry.tree, options)
    return [...treeFields(result.document, expected), ...diagnosticFields(result.diagnostics, expected)]
  }
  if (kind === 'position') {
    const result = engine.positionOf(input, entry.offset)
    return [...(expected.line !== undefined && result.line !== expected.line ? ['line'] : []),
      ...(expected.column !== undefined && result.column !== expected.column ? ['column'] : [])]
  }
  if (kind === 'fingerprint') {
    const fingerprint = entry.of === 'tree' ? treeFingerprint(engine.parse(input, { positions: false })) : sourceFingerprint(input)
    return fingerprint === expected.fingerprint ? [] : ['fingerprint']
  }
  if (kind === 'diff') {
    const first = engine.parse(input, { positions: false })
    const second = engine.parse(entry.inputAfter, { positions: false })
    const patch = diffTree(first, second)
    const actual = applyPatch(first, patch)
    const applies = same(JSON.parse(engine.encodeTree(actual)), JSON.parse(engine.encodeTree(second)))
    return [...(expected.applies === true && !applies ? ['applies'] : []),
      ...(expected.patch !== undefined && !same(patch, expected.patch) ? ['patch'] : [])]
  }
  if (kind === 'patch') {
    const tree = engine.parse(input, { positions: false })
    const fingerprint = entry.fingerprintOf === undefined ? undefined
      : treeFingerprint(engine.parse(entry.fingerprintOf, { positions: false }))
    const result = applyPatch(tree, entry.patch, { fingerprint })
    return childrenFields(result, expected)
  }
  if (kind === 'import') {
    const result = importDocument(entry.html, { from: 'html', ...options })
    const carve = expected.carve !== undefined && result.source !== expected.carve ? ['carve'] : []
    const suppressed = expected.suppressed !== undefined && result.suppressedDiagnostics !== expected.suppressed ? ['suppressed'] : []
    return [...childrenFields(result.document, expected), ...carve, ...suppressed,
      ...diagnosticFields(result.diagnostics, expected, entry.html)]
  }
  if (kind === 'layout') {
    const result = engine.parseWithLayout(input, parseOptions(options))
    return [...childrenFields(result.document, expected), ...layoutFields(result.layout, expected)]
  }
  if (kind === 'parse') {
    const result = engine.parseWithDiagnostics(input, options)
    return [...childrenFields(result.document, expected), ...treeFields(result.document, expected),
      ...diagnosticFields(result.diagnostics, expected, input, entry.files),
      ...(expected.suppressed !== undefined && result.suppressedDiagnostics !== expected.suppressed ? ['suppressed'] : [])]
  }
  if (kind === 'render') {
    const result = entry.host?.documentTransforms === undefined
      ? engine.renderWithDiagnostics(entry.tree ?? input, options)
      : engine.renderWithDocumentTransforms(entry.tree ?? input, documentTransforms(entry), options)
    const children = expected.children === undefined ? [] : childrenFields(engine.parse(input, parseOptions(options)), expected)
    if (expected.refusal !== undefined) engine.render(entry.tree ?? input, options)
    return [...children, ...(expected.html !== undefined && result.html !== expected.html ? ['html'] : []),
      ...diagnosticFields(result.diagnostics, expected, input, entry.files)]
  }
  if (kind === 'lint') return diagnosticFields(engine.lint(decoded(input), options), expected, input, entry.files)
  if (kind === 'format') {
    const result = engine.formatWithDiagnostics(decoded(input), options)
    if (expected.refusal !== undefined) engine.format(decoded(input), options)
    return [...(expected.carve !== undefined && result.source !== expected.carve ? ['carve'] : []),
      ...diagnosticFields(result.diagnostics, expected, input)]
  }
  if (kind === 'write') {
    const result = engine.writeWithDiagnostics(entry.tree, { ...options, ...(entry.layout ? { layout: entry.layout } : {}) })
    if (expected.refusal !== undefined) engine.write(entry.tree, options)
    return [...(expected.carve !== undefined && result.source !== expected.carve ? ['carve'] : []),
      ...diagnosticFields(result.diagnostics, expected)]
  }
  return ['kind']
}

export function newCaseMismatches(entry) {
  try {
    const fields = run(entry)
    const refusal = entry.expected.refusal === undefined ? [] : ['refusal']
    return [...new Set([...fields, ...refusal])].map(field => ({ field, actual: null, expected: null }))
  } catch (error) {
    const expected = entry.expected.refusal
    if (expected !== undefined && error?.name === expected.error) {
      const path = error?.path ?? (error?.option === undefined ? undefined : `/${error.option}`)
      const pathFields = expected.path === undefined || path === expected.path || path?.startsWith(`${expected.path}/`)
        ? [] : ['refusalPath']
      const diagnosticFieldsOnError = error?.diagnostics === undefined ? []
        : diagnosticFields(error.diagnostics, entry.expected)
      return [...pathFields, ...diagnosticFieldsOnError].map(field => ({ field, actual: null, expected: null }))
    }
    return [{ field: `threw:${error?.name ?? String(error)}`, actual: null, expected: null }]
  }
}
