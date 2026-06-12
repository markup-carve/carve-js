import { describe, it, expect } from 'vitest'
import { lintCarve, formatLintWarnings } from '../src/lint.js'

const rules = (src: string) => lintCarve(src).map((w) => w.rule)

describe('lintCarve — broken cross-references', () => {
  it('flags a </#id> with no matching heading', () => {
    const w = lintCarve('# Intro\n\nSee </#nope>.')
    expect(w).toHaveLength(1)
    expect(w[0]!.rule).toBe('broken-crossref')
    expect(w[0]!.message).toContain('</#nope>')
  })

  it('does not flag a crossref that targets a real heading', () => {
    expect(lintCarve('# Intro\n\nSee </#intro>.')).toEqual([])
  })

  it('treats the auto-suffixed id of a duplicate heading as valid', () => {
    // Two "Title" headings -> ids `title` and `title-2`; both resolvable.
    const w = lintCarve('# Title\n\n## Title\n\n</#title> and </#title-2>')
    expect(w.map((x) => x.rule)).toEqual(['duplicate-heading-id'])
  })

  it('honors an explicit heading id as a crossref target', () => {
    expect(lintCarve('{#start}\n# Intro\n\nSee </#start>.')).toEqual([])
  })

  it('finds a crossref nested below the top level (inside a list item)', () => {
    const w = lintCarve('# A\n\n- item with </#ghost> inside')
    expect(w.map((x) => x.rule)).toEqual(['broken-crossref'])
  })

  it('reports the crossref position', () => {
    const w = lintCarve('# A\n\nx </#ghost> y')
    expect(w[0]!.line).toBe(3)
    expect(w[0]!.column).toBe(3)
  })
})

describe('lintCarve — duplicate heading ids', () => {
  it('flags a second heading whose slug collides', () => {
    const w = lintCarve('# Setup\n\n## Setup')
    expect(w).toHaveLength(1)
    expect(w[0]!.rule).toBe('duplicate-heading-id')
    expect(w[0]!.line).toBe(3)
    expect(w[0]!.message).toContain('setup-2')
  })

  it('does not flag distinct heading slugs', () => {
    expect(lintCarve('# One\n\n## Two\n\n### Three')).toEqual([])
  })

  it('flags a repeated explicit id', () => {
    const w = lintCarve('{#dup}\n# A\n\n{#dup}\n# B')
    expect(w.map((x) => x.rule)).toEqual(['duplicate-heading-id'])
    expect(w[0]!.line).toBe(5)
  })

  it('flags three-way slug collisions once each (title-2, title-3)', () => {
    const w = lintCarve('# T\n\n## T\n\n### T')
    expect(w.map((x) => x.rule)).toEqual([
      'duplicate-heading-id',
      'duplicate-heading-id',
    ])
    expect(w[0]!.message).toContain('t-2')
    expect(w[1]!.message).toContain('t-3')
  })
})

describe('lintCarve — clean input', () => {
  it('returns nothing for an empty or plain document', () => {
    expect(lintCarve('')).toEqual([])
    expect(lintCarve('# Title\n\nJust prose, one heading.')).toEqual([])
  })
})

describe('formatLintWarnings', () => {
  it('renders file:line:col rule — message', () => {
    const w = lintCarve('# A\n\n</#x>')
    expect(formatLintWarnings(w, 'doc.crv')).toMatch(
      /^doc\.crv:3:1 broken-crossref — /,
    )
  })
})
