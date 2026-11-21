import { describe, expect, it } from 'vitest'
import { spanMarkCandidates } from '../src/backtick-rescue.ts'

describe('U-259 rescue candidate context', () => {
  it('finds a parsed table cell', () => {
    expect(spanMarkCandidates('|= ^|\n').map((candidate) => candidate.output)).toContain('|= |\n')
  })

  it('does not inspect code, raw, or comment payloads', () => {
    for (const source of ['```\n|= ^|\n```\n', '```=html\n|= ^|\n```\n', '{% |= ^| %}\n']) {
      expect(spanMarkCandidates(source)).toEqual([])
    }
  })
})
