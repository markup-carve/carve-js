import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const m = (s: string) => carveToHtml(s).trim()

describe('Severity-3 mention/tag name charset (grammar PART 9 §7)', () => {
  it('a name may start with a digit, underscore, or hyphen', () => {
    expect(m('@_bot')).toContain('<strong>@_bot</strong>')
    expect(m('@2fa')).toContain('<strong>@2fa</strong>')
    expect(m('#1tag')).toContain('<strong>#1tag</strong>')
  })

  it('dotted segments allow hyphens (full name, not truncated)', () => {
    expect(m('@john.doe-smith')).toContain('<strong>@john.doe-smith</strong>')
    expect(m('#a.b-c')).toContain('<strong>#a.b-c</strong>')
  })

  it('a trailing dot stays punctuation', () => {
    expect(m('@markus.')).toContain('<strong>@markus</strong></span>.')
  })

  it('an email address is still not a mention', () => {
    expect(m('me@example.com')).not.toContain('mention')
  })
})
