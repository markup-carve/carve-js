// C2-A-176 to C2-A-180: compare the stored-tree migration against both engines.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { carveToAstJson, carveToHtml } from '../../dist/index.js'
import { compareHtml } from '../../upgrade/src/compare.ts'
import { AST_RESULTS } from '../src/ast-tables.ts'
import { format, migrateTree, parse, render, treesEqual, write } from '../src/index.ts'
import { object } from '../migrate/shared.ts'

interface Input { name: string, source: string }
interface Finding { count: number, example: Input, path: string }

const ROOT = join(import.meta.dirname, '../..')
const OMIT = new Set(['.git', 'node_modules', 'dist', '.next'])
const IGNORED = new Set(['pos', 'segments', 'srcByteLength', 'stages', 'generatedId', 'number', 'resolvedAlign'])

function files(root: string, directory = root): Input[] {
  const result: Input[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (OMIT.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...files(root, path))
    else if (entry.isFile() && entry.name.endsWith('.crv')) {
      result.push({ name: relative(root, path), source: readFileSync(path, 'utf8') })
    }
  }
  return result
}

function inputs(full: boolean): Input[] {
  const examples: unknown = JSON.parse(readFileSync(join(ROOT, 'v2/data/examples.json'), 'utf8'))
  const result: Input[] = []
  const values: unknown[] = Array.isArray(examples) ? examples : []
  values.forEach((entry, index) => {
    if (typeof entry === 'object' && entry !== null && 'input' in entry && typeof entry.input === 'string') {
      result.push({ name: `example ${index + 1}`, source: entry.input })
    }
  })
  if (!full) return result
  for (const root of [ROOT, join(ROOT, '../carve'), join(ROOT, '../carve-main')]) {
    try { result.push(...files(root).map((input) => ({ ...input, name: `${root}: ${input.name}` }))) } catch { continue }
  }
  return result
}

function sameValue(left: unknown, right: unknown): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right)
}

function coalesced(values: unknown[]): unknown[] {
  const result: unknown[] = []
  for (const value of values) {
    const previous = result[result.length - 1]
    if (object(previous) && object(value) && previous['type'] === 'text' && value['type'] === 'text'
      && typeof previous['value'] === 'string' && typeof value['value'] === 'string') {
      result[result.length - 1] = { ...previous, value: previous['value'] + value['value'] }
    } else result.push(value)
  }
  return result
}

function firstArray(left: unknown[], right: unknown[], path: string): string | undefined {
  const a = coalesced(left)
  const b = coalesced(right)
  if (a.length !== b.length) return `${path}/length`
  for (let index = 0; index < a.length; index++) {
    const difference = firstDifference(a[index], b[index], `${path}/${index}`)
    if (difference !== undefined) return difference
  }
  return undefined
}

function ignored(node: Record<string, unknown>, key: string): boolean {
  if (IGNORED.has(key)) return true
  const type = node['type']
  if (typeof type !== 'string') return false
  const field = AST_RESULTS.get(type)?.find((entry) => entry.field === key)
  if (field === undefined) return false
  return field.when !== 'reference use' || node['key'] !== undefined
}

function firstObject(left: Record<string, unknown>, right: Record<string, unknown>, path: string): string | undefined {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of [...keys].sort()) {
    if (ignored(left, key) && ignored(right, key)) continue
    const difference = firstDifference(left[key], right[key], `${path}/${key}`)
    if (difference !== undefined) return difference
  }
  return undefined
}

function firstDifference(left: unknown, right: unknown, path = ''): string | undefined {
  if (sameValue(left, right)) return undefined
  if (Array.isArray(left) && Array.isArray(right)) return firstArray(left, right, path)
  if (object(left) && object(right)) return firstObject(left, right, path)
  return path
}

function fieldGroup(document: unknown, path: string): string {
  const segments = path.split('/').slice(1)
  const field = segments.at(-1) === 'length' ? segments.at(-2) : segments.at(-1)
  let value: unknown = document
  let type = 'document'
  for (const segment of segments.slice(0, -1)) {
    if (object(value)) {
      if (typeof value['type'] === 'string') type = value['type']
      value = value[segment]
    } else if (Array.isArray(value)) value = value[Number(segment)]
  }
  if (object(value) && typeof value['type'] === 'string') type = value['type']
  return `${type}.${field ?? 'value'}`
}

function add(findings: Map<string, Finding>, key: string, input: Input, path = key): void {
  const found = findings.get(key)
  if (found === undefined) findings.set(key, { count: 1, example: input, path })
  else {
    found.count++
    if (input.source.length < found.example.source.length) { found.example = input; found.path = path }
  }
}

function classify(source: string): string[] {
  try {
    if (!compareHtml(carveToHtml(source), render(source)).equal) return []
    const migrated = migrateTree(carveToAstJson(source), { source })
    const parsed = parse(source)
    const groups: string[] = []
    if (!treesEqual(migrated.document, parsed)) {
      groups.push(fieldGroup(migrated.document, firstDifference(migrated.document, parsed) ?? 'unknown'))
    }
    if (write(migrated.document, { layout: migrated.layout }) !== format(source)) groups.push('writer/bytes')
    return groups
  } catch { return [] }
}

function lineMinimal(source: string, group: string): string {
  let lines = source.split('\n')
  let changed = true
  while (changed && lines.length > 1) {
    changed = false
    for (let at = 0; at < lines.length; at++) {
      const candidate = [...lines.slice(0, at), ...lines.slice(at + 1)]
      if (!classify(candidate.join('\n')).includes(group)) continue
      lines = candidate
      changed = true
      break
    }
  }
  return lines.join('\n')
}

function run(all: Input[]): void {
  let sameReading = 0
  let equalTrees = 0
  let equalBytes = 0
  let equalTreeBytes = 0
  let migrationErrors = 0
  const findings = new Map<string, Finding>()
  for (const input of all) {
    try {
      const migrated = migrateTree(carveToAstJson(input.source), { source: input.source })
      const oldHtml = carveToHtml(input.source)
      const nextHtml = render(input.source)
      if (!compareHtml(oldHtml, nextHtml).equal) continue
      sameReading++
      const parsed = parse(input.source)
      const equal = treesEqual(migrated.document, parsed)
      if (equal) equalTrees++
      else {
        const path = firstDifference(migrated.document, parsed) ?? 'unknown'
        add(findings, fieldGroup(migrated.document, path), input, path)
      }
      if (write(migrated.document, { layout: migrated.layout }) === format(input.source)) {
        equalBytes++
        if (equal) equalTreeBytes++
      }
      else add(findings, 'writer/bytes', input)
    } catch (error) { migrationErrors++; add(findings, `error/${String(error).slice(0, 140)}`, input) }
  }
  console.log(JSON.stringify({ inputs: all.length, sameReading, equalTrees, equalBytes, equalTreeBytes, migrationErrors,
    differing: [...findings].map(
      ([group, item]) => ({ group, path: item.path, count: item.count, example: item.example.name,
        source: process.argv.includes('--minimize') ? lineMinimal(item.example.source, group) : item.example.source }),
  ) }, null, 2))
  if (migrationErrors > 0) process.exitCode = 1
}

run(inputs(process.argv.includes('--full')))
