import fs from 'node:fs'
import path from 'node:path'
import { lint } from './lint.ts'

const root = path.resolve('.')
const examples = JSON.parse(fs.readFileSync(new URL('./examples.json', import.meta.url), 'utf8'))
const counts = {}
const findings = []
const errors = []

function files(dir, extension, output = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) files(absolute, extension, output)
    else if (entry.name.endsWith(extension)) output.push(absolute)
  }
  return output
}

function scan(origin, source, category) {
  counts[category] ??= { inputs: 0, findings: 0, rules: {} }
  counts[category].inputs++
  try {
    for (const result of lint(source)) {
      counts[category].findings++
      counts[category].rules[result.code] = (counts[category].rules[result.code] ?? 0) + 1
      const start = result.range?.startOffset ?? 0
      const end = result.range?.endOffset ?? start
      findings.push({ category, origin, code: result.code, message: result.message, path: result.path,
        range: result.range, snippet: Buffer.from(source).subarray(start, Math.min(end, start + 120)).toString('utf8') })
    }
  } catch (error) {
    errors.push({ origin, error: String(error) })
  }
}

function fencedSources(filename) {
  const lines = fs.readFileSync(filename, 'utf8').split('\n')
  const sources = []
  for (let at = 0; at < lines.length; at++) {
    if (!/^\s*```(?:carve|crv)(?:\s.*)?$/i.test(lines[at])) continue
    const start = at + 1
    const body = []
    while (at + 1 < lines.length && !/^\s*```\s*$/.test(lines[at + 1])) body.push(lines[++at])
    if (at + 1 >= lines.length) break
    at++
    sources.push({ origin: `${filename}:${start + 1}`, source: body.join('\n') })
  }
  return sources
}

for (const filename of files(path.resolve(root, '../carve'), '.crv')) {
  scan(path.relative(root, filename), fs.readFileSync(filename, 'utf8'), 'carve-next2-crv')
}
for (const filename of files(root, '.crv')) {
  scan(path.relative(root, filename), fs.readFileSync(filename, 'utf8'), 'carve-js-next2-crv')
}
for (const example of examples) scan(example.origin, example.source, 'spec-examples')
for (const filename of files(path.resolve(root, '../carve-main'), '.crv')) {
  scan(path.relative(root, filename), fs.readFileSync(filename, 'utf8'), 'carve-main-crv')
}
for (const filename of files(path.resolve(root, '../carve-main/docs'), '.md')) {
  for (const example of fencedSources(filename)) scan(path.relative(root, example.origin), example.source, 'carve-main-docs')
}

console.log(JSON.stringify({ counts, errors, findings }))
