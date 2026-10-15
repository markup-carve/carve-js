import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { carveToHtml, carveToMarkdown, htmlToCarve, markdownToCarve, migrateMarkdown } from '../src/index.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

describe('imported cross-reference text', () => {
  for (const [source, run] of [
    ['{~a </#x~>y> b~}', '</#x~>y>'],
    ['^[a </#x]> b]', '</#x]>'],
    ['see </#x> here', '</#x>'],
  ]) {
    it(`keeps ${run} through Markdown and HTML`, () => {
      const markdown = carveToMarkdown(source)
      const fromMarkdown = markdownToCarve(markdown)
      const fromMigration = migrateMarkdown(markdown).value
      const fromHtml = htmlToCarve(carveToHtml(source)).value
      for (const imported of [fromMarkdown, fromMigration, fromHtml]) {
        expect(imported).toContain(run)
        expect(imported).not.toContain('</\\#')
      }
    })
  }

  it('keeps text literal when the converted heading has the id', () => {
    const source = markdownToCarve('# Intro\n\nsee </#intro> here')
    expect(source).toContain('see </\\#intro> here')
    expect(carveToHtml(source)).toContain('see &lt;/#intro&gt; here')
    expect(htmlToCarve('<h1 id="intro">Intro</h1><p>see &lt;/#intro&gt; here</p>').value).toContain('see </\\#intro> here')
  })

  it('does not promote an empty target or an escaped opener', () => {
    expect(markdownToCarve('see </#> here')).toContain('</#>')
    expect(htmlToCarve('<p>see \\&lt;/#x&gt; here</p>').value).toContain('</\\#x>')
  })

  it('keeps code, raw HTML, autolinks and destinations on their existing paths', () => {
    const source = '`</#x>` and [link](https://example.test/%3C/#x) and <https://example.test/#x>'
    expect(markdownToCarve(source)).toContain('`</#x>` and [link](https://example.test/%3C/#x)')
    expect(htmlToCarve('<p><code>&lt;/#x&gt;</code> <a href="https://example.test/%3C/#x">link</a></p>').value).toContain('`</#x>`')
    expect(htmlToCarve('<pre>&lt;/#x&gt;</pre>').value).toContain('</#x>')
    expect(htmlToCarve('<p>&#60;/#x&#62;</p>').value).toContain('</#x>')
  })

  it('round trips the available atomic corpus row', () => {
    const source = readFileSync('spec/tests/corpus/598-editorial-markup-closes-outside-a-cross-reference-or-a-bracket-run-5.crv', 'utf8').trim()
    const expected = carveToHtml(source)
    expect(carveToHtml(markdownToCarve(carveToMarkdown(source)))).toBe(expected)
    expect(carveToHtml(htmlToCarve(expected).value)).toBe(expected)
  })

  it('round trips corpus row 605-14 through HTML', () => {
    const source = '^[a </#x]> b]'
    const expected = carveToHtml(source)
    expect(carveToHtml(htmlToCarve(expected).value)).toBe(expected)
  })
})

perfIt('scans many imported cross-references linearly', () => {
  expectScansLinearly(input => { markdownToCarve(input) }, '</#a> ', { smallRepeats: 1_000, label: 'Markdown cross-references' })
  expectScansLinearly(input => { htmlToCarve(`<p>${input}</p>`) }, '&lt;/#a&gt; ', { smallRepeats: 1_000, label: 'HTML cross-references' })
})
