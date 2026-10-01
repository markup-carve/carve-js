import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a verse closer belongs to its quote depth', () => {
  for (const literal of ['- :::', '1. :::', '::::', '  :::']) {
    it(`keeps ${JSON.stringify(literal)} as verse text`, () => {
      const html = carveToHtml(`::: |\n${literal}\n[r]: /hidden\n:::\n\n[t][r]\n`)
      expect(html).toContain('[r]: /hidden')
      expect(html).not.toContain('href="/hidden"')
    })
  }

  it('does not treat a malformed opener as verse', () => {
    expect(carveToHtml(':::|\n\n[r]: /target\n\n[t][r]\n')).toContain('href="/target"')
  })

  it('rejects an indented document-level opener', () => {
    expect(carveToHtml('  ::: |\n  :::\n\n[r]: /target\n\n[t][r]\n')).toContain('href="/target"')
  })

  it('closes verse inside a list inside a quoted list item', () => {
    expect(carveToHtml('- > - ::: |\n  >   verse\n  >   :::\n  >   [r]: /target\n\n[t][r]\n')).toContain('href="/target"')
  })

  for (const source of [
    '- > - a\n  >   ::: |\n  >   [r]: /hidden\n  >   :::\n\n[t][r]\n',
    ':: term\n:   ::: |\n    [r]: /hidden\n    :::\n\n[t][r]\n',
    '[^n]:\n    ::: |\n    [r]: /hidden\n    :::\n\n[t][r] [^n]\n',
  ]) {
    it(`keeps nested verse definitions literal: ${JSON.stringify(source.split('\n')[0])}`, () => {
      const html = carveToHtml(source)
      expect(html).toContain('[r]: /hidden')
      expect(html).not.toContain('href="/hidden"')
    })
  }

  for (const prefix of ['', '> ', '> > ']) {
    it(`keeps a deeper quoted fence as verse text at depth ${prefix.length / 2}`, () => {
      const source = `${prefix}::: |\n${prefix}> :::\n${prefix}[r]: /hidden\n${prefix}::: \n\n[t][r]\n`
      const html = carveToHtml(source)
      expect(html).toContain('[r]: /hidden')
      expect(html).toContain('[t][r]')
      expect(html).not.toContain('href="/hidden"')
    })

    it(`still collects a definition after the real closer at depth ${prefix.length / 2}`, () => {
      const source = `${prefix}::: |\n${prefix}> :::\n${prefix}verse\n${prefix}::: \n${prefix}[r]: /target\n\n[t][r]\n`
      expect(carveToHtml(source)).toContain('href="/target"')
    })
  }
})
