import { describe, expect, it } from 'vitest'
import { closedRunCandidates } from '../src/backtick-rescue.ts'

describe('unclosed backtick candidate context', () => {
  it('finds an unclosed run in a parsed paragraph', () => {
    expect(closedRunCandidates('a `b\n').map((candidate) => candidate.output)).toContain('a `b`\n')
  })

  it('does not propose a closer inside code, raw, or comment payloads', () => {
    for (const source of ['```\n`x\n```\n', '```=html\n`x\n```\n', '{% `x %}\n']) {
      expect(closedRunCandidates(source)).toEqual([])
    }
  })
})
