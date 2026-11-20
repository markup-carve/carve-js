import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fix } from '../public/index.ts'

interface ClauseCase { kind: string, input?: string }
const lintCases = (JSON.parse(readFileSync(new URL('../data/conformance/clause-cases.json', import.meta.url), 'utf8')) as
  { cases: ClauseCase[] }).cases.filter((row) => row.kind === 'lint' && typeof row.input === 'string')

function document(seeds: readonly string[], size: number): string {
  let source = ''
  for (let at = 0; source.length < size; at++) source += seeds[at % seeds.length]
  return source.slice(0, size)
}

const shapes: readonly [string, readonly string[]][] = [
  ['repeated collisions', ['**_x_**\n']],
  ['varied generated lines', ['**_x_**\n', '## Heading ##\n', '+ item\n', '~~abc~~ and _def_\n',
    '> **strong** and _em_\n', 'plain words here\n']],
  ['concatenated lint clauses', lintCases.map((row) => row.input!)],
]

describe('fix performance smoke', () => {
  for (const [name, seeds] of shapes) {
    it(`finishes a 32 KB ${name} document within the smoke budget`, () => {
      const source = document(seeds, 32 * 1024)
      const started = performance.now()
      const result = fix(source)
      expect(result.output.length).toBeGreaterThan(0)
      // The optimized build target is one second. CI can share a busy runner, so the
      // smoke bound allows ten seconds while still catching the old minute-long path.
      expect(performance.now() - started).toBeLessThan(10_000)
    }, 15_000)
  }
})
