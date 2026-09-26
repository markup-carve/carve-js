import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { citations } from '../src/citations.js'
import { glossary } from '../src/glossary.js'
import { index } from '../src/index-terms.js'
import { tocPlacement } from '../src/table-of-contents.js'

const placed = 'a[^1]\n\n::: footnotes "Notes" [End]\n:::\n\n[^1]: body\n'

/** What an untitled, unlabeled marker renders: the same lines, minus the tokens. */
const withoutTokens = (html: string): string =>
  html
    .split('\n')
    .filter((line) => !/class="(admonition-title|div-label)"/.test(line))
    .join('\n')

describe('a titled directive names the region it places (CARVE-P9-072)', () => {
  it('opens the endnotes section with the title, the label and then the rule', () => {
    expect(carveToHtml(placed)).toContain(
      [
        '<section role="doc-endnotes" aria-labelledby="adm-1">',
        '  <p class="admonition-title" id="adm-1">Notes</p>',
        '  <p class="div-label">End</p>',
        '  <hr>',
      ].join('\n'),
    )
  })

  it('leaves an untitled marker byte-identical', () => {
    const marker = carveToHtml('a[^1]\n\n::: footnotes\n:::\n\n[^1]: body\n')
    const none = carveToHtml('a[^1]\n\n[^1]: body\n')
    expect(marker).toContain('<section role="doc-endnotes" aria-label="Footnotes">')
    expect(marker).toBe(none)
  })

  it('draws the id from the one sequence a titled admonition uses', () => {
    const html = carveToHtml('::: note "First"\nx\n:::\n\na[^1]\n\n::: footnotes "Notes"\n:::\n\n[^1]: body\n')
    expect(html).toContain('<p class="admonition-title" id="adm-1">First</p>')
    expect(html).toContain('<section role="doc-endnotes" aria-labelledby="adm-2">')
    expect(html).toContain('<p class="admonition-title" id="adm-2">Notes</p>')
  })

  it('takes its id in document order, ahead of a titled block written inside it', () => {
    const html = carveToHtml('a[^1]\n\n::: footnotes "Notes"\n::: note "Inner"\nx\n:::\n:::\n\n[^1]: body\n')
    expect(html).toContain('<section role="doc-endnotes" aria-labelledby="adm-1">')
    expect(html).toContain('<p class="admonition-title" id="adm-2">Inner</p>')
  })

  it('names the TOC nav with the title in place of the tocNav default', () => {
    const html = carveToHtml('# Intro\n\n::: toc "Contents" [T]\n:::\n', { extensions: [tocPlacement()] })
    expect(html).toContain(
      [
        '<nav class="toc" aria-labelledby="adm-1">',
        '<p class="admonition-title" id="adm-1">Contents</p>',
        '<p class="div-label">T</p>',
        '<ul>',
      ].join('\n'),
    )
    expect(html).not.toContain('aria-label="Table of contents"')
  })

  it('keeps an author-written name and mints no id for it', () => {
    const html = carveToHtml('# Intro\n\n{aria-label="Mine"}\n::: toc "Contents"\n:::\n', {
      extensions: [tocPlacement()],
    })
    // The structural class follows the authored name (markup-carve/carve#2328).
    expect(html).toContain('<nav aria-label="Mine" class="toc">')
    expect(html).toContain('<p class="admonition-title">Contents</p>')
    expect(html).not.toContain('aria-labelledby')
  })

  it('carries both tokens into a degraded div, with no name on it', () => {
    const html = carveToHtml('::: footnotes "Notes" [End]\n:::\n')
    expect(html).toContain('<div class="footnotes">')
    expect(html).toContain('<p class="admonition-title">Notes</p>')
    expect(html).toContain('<p class="div-label">End</p>')
    expect(html).not.toContain('aria-label')
  })

  it('puts the tokens before a glossary, whose <dl> holds no paragraph', () => {
    const html = carveToHtml(':: T\n: d\n\n::: glossary "Gloss" [G]\n:: T2\n: d2\n:::\n', {
      extensions: [glossary()],
    })
    expect(html).toContain(
      ['<p class="admonition-title">Gloss</p>', '<p class="div-label">G</p>', '<dl class="glossary">'].join('\n'),
    )
    expect(html).not.toContain('aria-labelledby')
  })

  it('puts the tokens before an index list, whose <ul> holds no paragraph', () => {
    const src = (tokens: string) => `A :index[parser] here.\n\n::: index${tokens}\n:::\n`
    const opts = { extensions: [index()] }
    const html = carveToHtml(src(' "Idx" [I]'), opts)
    expect(html).toContain(
      ['<p class="admonition-title">Idx</p>', '<p class="div-label">I</p>', '<ul class="index">'].join('\n'),
    )
    expect(html).not.toContain('aria-labelledby')
    expect(html).not.toContain('adm-')
    expect(withoutTokens(html)).toBe(carveToHtml(src(''), opts))
  })

  it('carries both tokens into a references list, with no name on it', () => {
    const src = (tokens: string) => `See [@k].\n\n::: references${tokens}\n:::\n\n[@k]: An entry\n`
    const opts = { extensions: [citations()] }
    const html = carveToHtml(src(' "Cited" [R]'), opts)
    expect(html).toContain(
      [
        '<div class="references">',
        '  <p class="admonition-title">Cited</p>',
        '  <p class="div-label">R</p>',
        '  <ol class="references">',
      ].join('\n'),
    )
    expect(html).not.toContain('aria-label')
    expect(html).not.toContain('adm-')
    expect(withoutTokens(html)).toBe(carveToHtml(src(''), opts))
  })

  it('carries both tokens into a bibliography marker that places nothing itself', () => {
    const bibliography = [{ id: 'k', author: [{ family: 'Doe' }], title: 'An entry' }]
    const html = carveToHtml('See [@k].\n\n::: bibliography "Sources" [B]\n:::\n', {
      extensions: [citations({ bibliography })],
    })
    expect(html).toContain(
      [
        '<div class="bibliography">',
        '  <p class="admonition-title">Sources</p>',
        '  <p class="div-label">B</p>',
        '</div>',
      ].join('\n'),
    )
    expect(html).not.toContain('aria-label')
    expect(html).not.toContain('adm-')
  })

  it('leaves a label alone with the name the labels map supplies, and mints no id', () => {
    const notes = carveToHtml('a[^1]\n\n::: footnotes [End]\n:::\n\n[^1]: body\n')
    expect(notes).toContain(
      ['<section role="doc-endnotes" aria-label="Footnotes">', '  <p class="div-label">End</p>', '  <hr>'].join('\n'),
    )
    expect(notes).not.toContain('adm-')

    const toc = carveToHtml('# Intro\n\n::: toc [T]\n:::\n', { extensions: [tocPlacement()] })
    expect(toc).toContain(
      ['<nav class="toc" aria-label="Table of contents">', '<p class="div-label">T</p>', '<ul>'].join('\n'),
    )
    expect(toc).not.toContain('adm-')
  })
})
