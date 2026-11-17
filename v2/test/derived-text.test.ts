// C2-H-201: one budget of derived text per render, shared by abbreviations and resolved cross-references.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DERIVED_TEXT_BYTES, DERIVED_TEXT_FACTOR } from '../src/derived-text.ts'
import { parse, renderWithDiagnostics } from '../src/index.ts'

const limits = JSON.parse(readFileSync(join(import.meta.dirname, '../data/limits.json'), 'utf8')) as {
  limits: { name: string, value: number }[]
}

function codes(diagnostics: readonly { code: string }[]): string[] {
  return diagnostics.map((entry) => entry.code).filter((code) => code === 'derived-text-budget')
}

describe('the derived text budget', () => {
  it('C2-H-201: the two numbers are those of data/limits.json', () => {
    expect(limits.limits.find((row) => row.name === 'derived_text_bytes')?.value).toBe(DERIVED_TEXT_BYTES)
    expect(limits.limits.find((row) => row.name === 'derived_text_factor')?.value).toBe(DERIVED_TEXT_FACTOR)
  })

  it('C2-H-201: past the budget an abbreviation is its term, reported once, and a later one that fits still draws', () => {
    // The source is about 400,000 bytes, so the budget is about 3,200,000 bytes: eight expansions fit.
    const source = `${'A '.repeat(10)}B\n\n*[A]: ${'x'.repeat(400_000)}\n*[B]: short\n`
    const result = renderWithDiagnostics(source)
    expect(result.html.match(/<abbr /g)).toHaveLength(9)
    expect(result.html).toContain('<abbr title="short">B</abbr>')
    expect(codes(result.diagnostics)).toEqual(['derived-text-budget'])
  })

  it('C2-H-201: a cross-reference past the budget links around its key', () => {
    const source = `{#h}\n# ${'T'.repeat(100_000)}\n\n${'</#h> '.repeat(12)}\n`
    const result = renderWithDiagnostics(source)
    expect(result.html.match(/<a href="#h">h<\/a>/g)?.length).toBe(2)
    expect(codes(result.diagnostics)).toEqual(['derived-text-budget'])
  })

  it('C2-H-201: a supplied tree without srcByteLength has the fixed budget', () => {
    const tree = structuredClone(parse(`A A A\n\n*[A]: ${'y'.repeat(400_000)}\n`))
    delete tree.srcByteLength
    expect(renderWithDiagnostics(tree).html.match(/<abbr /g)).toHaveLength(2)
    tree.srcByteLength = 200_000
    expect(renderWithDiagnostics(tree).html.match(/<abbr /g)).toHaveLength(3)
  })
})
