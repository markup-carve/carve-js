import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CarveOptionError, parseWithDiagnostics } from '../src/index.ts'

interface Rule { id: string; channel: string; messages: (string | { text: string })[] }
interface Case { id: string; input: unknown; options: Parameters<typeof parseWithDiagnostics>[1] }

const rules = (JSON.parse(readFileSync(new URL('../data/lint-rules.json', import.meta.url), 'utf8')) as { rules: Rule[] }).rules
const cases = (JSON.parse(readFileSync(new URL('../data/conformance/clause-cases.json', import.meta.url), 'utf8')) as { cases: Case[] }).cases

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const templates = new Map(rules.filter((rule) => rule.channel === 'parse').map((rule) => [rule.id, rule.messages.map((entry) => {
  const text = typeof entry === 'string' ? entry : entry.text
  return new RegExp(`^${text.split(/\$\{[^}]+\}/).map(escape).join('[\\s\\S]*')}$`)
})]))

/** The parse findings of a case; a case whose options belong to a later stage has none here. */
function findings(entry: Case & { input: string }): ReturnType<typeof parseWithDiagnostics>['diagnostics'] {
  try {
    return parseWithDiagnostics(entry.input, entry.options).diagnostics
  } catch (error) {
    if (error instanceof CarveOptionError) return []
    throw error
  }
}

describe('parse-channel messages use the pinned 0.2 diagnostic catalog', () => {
  it('every parse finding of every clause case matches a template of its code', () => {
    const drift: string[] = []
    let checked = 0
    for (const entry of cases) {
      if (typeof entry.input !== 'string') continue
      const text = entry as Case & { input: string }
      for (const finding of findings(text)) {
        if (finding.channel !== 'parse') continue
        checked++
        const patterns = templates.get(finding.code) ?? []
        if (!patterns.some((pattern) => pattern.test(finding.message))) drift.push(`${entry.id} ${finding.code}: ${finding.message}`)
      }
    }
    expect(checked).toBeGreaterThan(100)
    expect(drift).toEqual([])
  })

  it('C2-B-163: a later unclosed frontmatter block gets the catalog text, not a line-1 claim', () => {
    const messages = parseWithDiagnostics('a\n\n---yaml\nk: v\n\n# Lost\n').diagnostics
      .filter((finding) => finding.code === 'unclosed-frontmatter').map((finding) => finding.message)
    expect(messages).toEqual(['This frontmatter block has no closing line, so it runs to the end of the document.'])
  })
})
