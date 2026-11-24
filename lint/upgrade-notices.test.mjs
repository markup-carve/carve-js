import { describe, expect, it } from 'vitest'
import { lint } from './lint.ts'
import { CATALOG } from './catalog.ts'

const NOTICES = ['blank-reference-label', 'comment-fence-closer-with-text', 'deprecated-bare-highlight',
  'deprecated-bare-strike', 'deprecated-bare-underline', 'deprecated-cell-alignment', 'deprecated-continuation-marker',
  'deprecated-indented-line-under-heading', 'deprecated-loose-attribute', 'deprecated-separator-row',
  'deprecated-spaced-thematic-break', 'deprecated-substitution-arrow', 'deprecated-table-attribute',
  'description-term-multi-line', 'djot-emphasis-underscore', 'djot-heading-continuation', 'djot-intraword-underscore',
  'djot-plus-bullet', 'djot-subscript-tilde', 'djot-subscript-tilde-braced', 'djot-superscript-caret',
  'sigil-after-letter', 'thematic-break-spelling', 'tight-list-item-with-blank-line']
const HEADING = '# a\n b\n'
const reported = (source, options = {}) => lint(source, options)
  .some((entry) => entry.code === 'deprecated-indented-line-under-heading')
const declared = (frontmatter) => reported(`---\n${frontmatter}\n---\n${HEADING}`)

describe('C2-W-156: migration notices', () => {
  it('are the catalog rows whose default is upgrade', () => {
    expect(Object.keys(CATALOG).filter((id) => CATALOG[id].default === 'upgrade').sort()).toEqual(NOTICES)
  })

  it('are off by default and on under the option upgrade', () => {
    expect(reported(HEADING)).toBe(false)
    expect(reported(HEADING, { upgrade: false })).toBe(false)
    expect(reported(HEADING, { upgrade: true })).toBe(true)
  })

  it('are on for a line-1 declaration below 0.2', () => {
    for (const value of ['0.1', '0.1.13', '0', '0.0', '00.01', '0.1.0.0']) {
      expect(declared(`carve: ${value}`), value).toBe(true)
      expect(declared(`carve-version: ${value}`), value).toBe(true)
    }
    expect(declared('title: x\ncarve:  0.1 ')).toBe(true)
  })

  it('stay off for a declaration of 0.2 or later, or one that is no dotted version', () => {
    for (const value of ['0.2', '0.10', '0.2.0', '1.0', '1', '"0.1"', '0.1-beta', '0.', '.1', 'v0.1', '0.1 # old']) {
      expect(declared(`carve: ${value}`), value).toBe(false)
    }
    expect(declared('carve: 0.2\ncarve-version: 0.1')).toBe(false)
    expect(declared('version: 0.1')).toBe(false)
  })

  it('read only the line-1 frontmatter', () => {
    expect(reported(`﻿---\ncarve: 0.1\n---\n${HEADING}`)).toBe(true)
    expect(reported(`\n---\ncarve: 0.1\n---\n${HEADING}`)).toBe(false)
    expect(reported(`---\ntitle: x\n---\n\n---yaml\ncarve: 0.1\n---\n${HEADING}`)).toBe(false)
  })

  it('follow rules over the declaration and over upgrade', () => {
    const off = { rules: { 'deprecated-indented-line-under-heading': 'off' } }
    expect(reported(HEADING, { ...off, upgrade: true })).toBe(false)
    expect(declared('carve: 0.1') && !reported(`---\ncarve: 0.1\n---\n${HEADING}`, off)).toBe(true)
    expect(reported(HEADING, { rules: { 'deprecated-indented-line-under-heading': 'on' } })).toBe(true)
  })

  it('leave the other rules at their defaults', () => {
    const codes = (options) => lint('_a_ **b**\n', options).map((entry) => entry.code)
    expect(codes({ upgrade: true }).filter((code) => !NOTICES.includes(code))).toEqual(codes())
    expect(codes()).toEqual(['markdown-strong-double-star'])
  })

  it('refuse an upgrade value that is not a boolean', () => {
    expect(() => lint(HEADING, { upgrade: 'yes' })).toThrow(/upgrade/)
  })
})
