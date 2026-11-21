import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { compareHtml, compareHtmlExact, htmlTokens } from '../src/compare.ts'
import { html01, html02 } from '../src/engines.ts'
import { upgrade } from '../src/upgrade.ts'

interface Example { id: string; input: string }
interface Contract { id: string; class: string; inputs: string[]; outputs: string[] }
interface Change { id: string; before: string[]; after: string[]; left: string | null; right: string | null }
const NONLOCAL = new Set(['U-114', 'U-130', 'U-146', 'U-195', 'U-209', 'U-219', 'U-221', 'U-224'])

const root = join(import.meta.dirname, '..')
const contract = JSON.parse(readFileSync(join(root, 'test/contract.json'), 'utf8')) as Contract[]
const measured = JSON.parse(readFileSync(join(root, 'data/measured-reports.json'), 'utf8')) as Example[]
const examples: Example[] = contract.filter((entry) => entry.class === 'report' || entry.id === 'U-114')
  .flatMap((entry) => entry.inputs.map((input) => ({ id: entry.id, input }))).concat(measured)
for (const entry of contract) for (const input of entry.inputs) {
  const converted = upgrade(input)
  const old = html01(input)
  const next = html02(converted.output, converted.records.some((record) =>
    record.entry === 'U-076' || record.entry === 'U-077'))
  if (compareHtmlExact(old, next).equal) continue
  if (compareHtml(old, next).equal) examples.push({ id: 'U-019', input })
  else if (compareHtml(old, next, true).equal) examples.push({ id: 'U-021', input })
}

const changes: Change[] = []
for (const example of examples) {
  let old: string[]
  let next: string[]
  try {
    old = htmlTokens(html01(example.input))
    const converted = upgrade(example.input)
    next = htmlTokens(html02(converted.output, converted.records.some((record) =>
      record.entry === 'U-076' || record.entry === 'U-077')))
  } catch { continue }
  let start = 0
  while (start < old.length && start < next.length && old[start] === next[start]) start++
  let endOld = old.length
  let endNext = next.length
  while (endOld > start && endNext > start && old[endOld - 1] === next[endNext - 1]) {
    endOld--
    endNext--
  }
  const before = old.slice(start, endOld)
  const after = next.slice(start, endNext)
  if (before.length === 0 || before.length > 8 || after.length > 8) continue
  if (example.id === 'U-019' || example.id === 'U-021' || example.id === 'U-154' || NONLOCAL.has(example.id)) continue
  changes.push({ id: example.id, before, after, left: old[start - 1] ?? null, right: old[endOld] ?? null })
}
const unique = changes.filter((change, index) => changes.findIndex((other) => JSON.stringify(other) === JSON.stringify(change)) === index)
writeFileSync(join(root, 'data/html-transformations.json'), JSON.stringify(unique, null, 2) + '\n')
process.stdout.write(`${unique.length} HTML transformations\n`)
