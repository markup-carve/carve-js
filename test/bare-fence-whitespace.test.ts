import { describe, expect, it } from 'vitest'
import { parseWithDiagnostics } from '../src/index.ts'

const diagnostics = (src: string) => parseWithDiagnostics(src).diagnostics.filter((entry) => entry.code === 'fence-title-syntax')

describe('C2-B-122: whitespace-only bare fence tails', () => {
  it('reports only a tab directly behind the run across all 28 one-to-three-character tails', () => {
    for (const run of ['```', '````']) {
      for (let length = 1; length <= 3; length++) {
        for (let bits = 0; bits < 1 << length; bits++) {
          const tail = Array.from({ length }, (_, at) => bits & (1 << at) ? '\t' : ' ').join('')
          const findings = diagnostics(`${run}${tail}\nx\n${run}\n`)
          expect(findings.map((entry) => entry.range?.startOffset)).toEqual(tail[0] === '\t' ? [run.length] : [])
        }
      }
    }
  })

  it('still reports text after whitespace at the first character of the text', () => {
    expect(diagnostics('```  b\nx\n```\n').map((entry) => entry.range?.startOffset)).toEqual([5])
    expect(diagnostics('``` \tb\nx\n```\n').map((entry) => entry.range?.startOffset)).toEqual([5])
  })
})
