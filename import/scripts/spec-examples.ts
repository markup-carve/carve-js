// The render examples of the specification corpus the engine pins (data/conformance/examples.json).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface SpecExample { file: string, number: number, input: string, html: string }

interface CorpusEntry { document: string, number: number, kind: string, input?: string, expected: { html?: string } }

export function specExamples(): SpecExample[] {
  const path = join(import.meta.dirname, '../../data/conformance/examples.json')
  const { examples } = JSON.parse(readFileSync(path, 'utf8')) as { examples: CorpusEntry[] }
  return examples.flatMap(entry => entry.kind === 'render' && entry.input !== undefined && entry.expected.html !== undefined
    ? [{ file: entry.document, number: entry.number, input: entry.input, html: entry.expected.html }] : [])
}
