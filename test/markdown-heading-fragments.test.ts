import { expect, it } from 'vitest'
import { markdownToCarve } from '../src/markdown-migrate.js'
import { migrateMarkdown } from '../src/migration.js'

it('rewrites a lowercase same-file heading fragment', () => {
  expect(markdownToCarve('# Install Steps\n\n[steps](#install-steps)')).toBe('# Install Steps\n\n[steps](#Install-Steps)')
})

it('keeps ambiguous and unrelated fragments unchanged', () => {
  const result = markdownToCarve('# Install Steps\n\n# install steps\n\n[steps](#INSTALL-STEPS) [other](#missing)')
  expect(result).toContain('[steps](#INSTALL-STEPS)')
  expect(result).toContain('[other](#missing)')
})

it('keeps an exact HTML id ahead of a case-only heading match', () => {
  const result = markdownToCarve('# Install Steps\n\n<a id="install-steps"></a>\n\n[steps](#install-steps)')
  expect(result).toContain('[steps](#install-steps)')
})

it('leaves Markdown duplicate heading suffixes for review', () => {
  const result = markdownToCarve('# Foo\n\n# Foo\n\n# Foo\n\n[third](#foo-2)')
  expect(result).toContain('[third](#foo-2)')
})

it('rewrites a heading inside a quote', () => {
  expect(markdownToCarve('> # Quote Head\n\n[quote](#quote-head)')).toContain('[quote](#Quote-Head)')
})

it('does not alias a raw HTML heading', () => {
  expect(markdownToCarve('# Real\n\n<h1 id="Fake">Raw</h1>\n\n[raw](#fake)')).toContain('[raw](#fake)')
  expect(markdownToCarve('# Fake\n\n<h1 id="Fake">Raw</h1>\n\n[native](#fake)')).toContain('[native](#Fake)')
})

it('keeps a zero-padded heading number available for case-only matching', () => {
  expect(markdownToCarve('# Version 02\n\n[version](#version-02)')).toContain('[version](#Version-02)')
})

it('matches Unicode lowercase fragments as whole strings', () => {
  expect(markdownToCarve('# ΟΔΟΣ\n\n[street](#οδος)')).toContain('#%CE%9F%CE%94%CE%9F%CE%A3')
})

it('reports a same-file rewrite as a fixup beside a complete assessment', () => {
  const result = migrateMarkdown('# Install Steps\n\nSee [steps](#install-steps).\n')
  expect(result.value).toBe('# Install Steps\n\nSee [steps](#Install-Steps).\n')
  expect(result.report.diagnostics.map(row => row.code)).toEqual(['markdown-atx-heading', 'markdown-paragraph', 'markdown-link', 'link-fragment-case-rewritten'])
  expect(result.report.diagnostics.at(-1)).toEqual({
    code: 'link-fragment-case-rewritten',
    message: 'Rewrote link fragment #install-steps to #Install-Steps, the one heading id it matches without regard to case.',
    severity: 'info',
    fidelity: 'normalized',
    confidence: 'inferred',
    path: 'link:#install-steps',
  })
})

it('names the fragment as the link wrote it, not percent-encoded (CARVE-P2-031)', () => {
  const result = migrateMarkdown('# Über Uns\n\nSee [a](#über-uns).\n')
  expect(result.value).toBe('# Über Uns\n\nSee [a](#%C3%9Cber-Uns).\n')
  expect(result.report.diagnostics).toEqual([
    expect.objectContaining({ code: 'fidelity-unverified', severity: 'warning', fidelity: 'dropped', confidence: 'fallback' }),
    {
      code: 'link-fragment-case-rewritten',
      message: 'Rewrote link fragment #über-uns to #%C3%9Cber-Uns, the one heading id it matches without regard to case.',
      severity: 'info',
      fidelity: 'normalized',
      confidence: 'inferred',
      path: 'link:#über-uns',
    },
  ])
})

it('falls back to the encoded fragment when two spellings encode alike', () => {
  const result = migrateMarkdown('# Über Uns\n\nSee [a](#über-uns) and [b](#%C3%BCber-uns).\n')
  expect(result.report.diagnostics.slice(1).map(row => row.path)).toEqual(['link:#%C3%BCber-uns', 'link:#%C3%BCber-uns'])
})

it('reports no fixup for an ambiguous or exact fragment', () => {
  const ambiguous = migrateMarkdown('# Twin\n\n# twin\n\n[x](#TWIN)\n')
  const exact = migrateMarkdown('# Install Steps\n\n[x](#Install-Steps)\n')
  for (const result of [ambiguous, exact]) expect(result.report.diagnostics.some(row => row.code === 'link-fragment-case-rewritten')).toBe(false)
})

it('names the authored fragment and the encoded rewrite in a Unicode fixup', () => {
  const result = migrateMarkdown('# ΟΔΟΣ\n\n[street](#οδος)\n')
  expect(result.report.diagnostics.at(-1)?.message).toBe('Rewrote link fragment #οδος to #%CE%9F%CE%94%CE%9F%CE%A3, the one heading id it matches without regard to case.')
})
