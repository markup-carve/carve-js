import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseWithDiagnostics } from '../src/index.ts'

interface Case {
  id: string
  kind: string
  input?: string
  options: Record<string, unknown>
  expected: { diagnostics?: { code: string; channel: string }[] }
}

interface Rule { id: string; channel: string; messages?: unknown[] }

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const rules = (read('../data/lint-rules.json') as { rules: Rule[] }).rules

// Rows with one message and no `${...}` placeholder: the engine must emit that text verbatim.
const fixed = new Map<string, string>()
for (const rule of rules) {
  const [message, ...rest] = rule.messages ?? []
  if (rule.channel === 'parse' && rest.length === 0 && typeof message === 'string' && !message.includes('${')) fixed.set(rule.id, message)
}

const cases = (read('../data/conformance/clause-cases.json') as { cases: Case[] }).cases.filter((entry) =>
  entry.kind === 'parse' && Object.keys(entry.options).length === 0 && typeof entry.input === 'string'
  && (entry.expected.diagnostics ?? []).some((item) => item.channel === 'parse' && fixed.has(item.code)))

describe('C2-W-106: parse findings with a fixed catalog message carry that message', () => {
  it('finds cases to check', () => expect(cases.length).toBeGreaterThan(0))
  for (const entry of cases) it(entry.id, () => {
    const found = parseWithDiagnostics(entry.input ?? '').diagnostics
    for (const expected of entry.expected.diagnostics ?? []) {
      const message = fixed.get(expected.code)
      if (message === undefined) continue
      expect(found.filter((item) => item.code === expected.code).map((item) => item.message)).toContain(message)
    }
  })
})
