import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import * as current from '../dist/index.js'

const oldPath = resolve('../carve-js-base-ast2/dist/index.js')
if (!existsSync(oldPath)) { console.log(`SKIP: old build missing at ${oldPath}`); process.exit(0) }
const old = await import(pathToFileURL(oldPath).href)
const paths = []
function walk(dir) { for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) walk(path); else if (entry.isFile() && path.endsWith('.crv')) paths.push(path) } }
walk('spec/tests/corpus')
const counts = [0, 0, 0]
const failures = []
function firstDiff(a, b, path = '') {
  if (isDeepStrictEqual(a, b)) return null
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) { const result = firstDiff(a[key], b[key], `${path}/${key}`); if (result) return result }
  }
  return `${path || '/'}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`.slice(0, 350)
}
function removePos(value, paths, path = '') {
  if (Array.isArray(value)) return value.map((item, index) => removePos(item, paths, `${path}/${index}`))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    if (key === 'pos' || key === 'cellWraps' || key === 'segments') { paths.push(`${path}/${key}`); return [] }
    return [[key, removePos(child, paths, `${path}/${key}`)]]
  }))
}
for (const file of paths) {
  try {
    const source = readFileSync(file, 'utf8')
    const prior = old.toAstJson(old.parse(source))
    const expected = current.toAstJson(current.parse(source))
    const withSource = current.migrateAstJson(prior, { source })
    const diff1 = firstDiff(withSource.tree, expected) ?? (withSource.losses.length ? `unexpected losses: ${JSON.stringify(withSource.losses)}` : null)
    if (diff1) failures.push(`${file} gate 1 ${diff1}`); else counts[0]++
    const paths = []
    const without = current.migrateAstJson(prior)
    const diff2 = firstDiff(without.tree, removePos(expected, paths)) ?? firstDiff(without.losses.map(loss => loss.path).sort(), paths.sort())
    if (diff2) failures.push(`${file} gate 2 ${diff2}`); else counts[1]++
    try { current.fromAstJson(withSource.tree); current.fromAstJson(without.tree); counts[2]++ }
    catch (error) { failures.push(`${file} gate 3 ${error.message}`) }
  } catch (error) { failures.push(`${file}: ${error.stack || error}`) }
}
console.log(`documents ${paths.length}; gate 1 ${counts[0]}; gate 2 ${counts[1]}; gate 3 ${counts[2]}; failures ${failures.length}`)
for (const failure of failures) console.log(failure)
if (failures.length) process.exitCode = 1
