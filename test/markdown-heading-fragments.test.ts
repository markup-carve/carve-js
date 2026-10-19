import { expect, it } from 'vitest'
import { markdownToCarve } from '../src/markdown-migrate.js'

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
