import { expect, it } from 'vitest'
import { decodeTree, parse, renderWithDiagnostics } from '../src/index.ts'

it('C2-A-010 and C2-H-201: JSON keeps the supplied length but caps derived text', () => {
  const tree = parse(`{#h}\n# ${'T'.repeat(4000)}\n\n${'</#h> '.repeat(4000)}\n`)
  tree.srcByteLength = 1_000_000_000
  const json = JSON.stringify(tree)
  const decoded = decodeTree(json)
  expect(decoded.srcByteLength).toBe(1_000_000_000)
  const result = renderWithDiagnostics(decoded)
  expect(result.diagnostics.map((entry) => entry.code)).toContain('derived-text-budget')
})
