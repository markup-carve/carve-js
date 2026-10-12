import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { carveToAnsi, carveToMarkdown, carveToPlainText, migrateMarkdown, parse, renderCarve } from '../src/index.js'

const unstyled = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, '')
const targets = {
  markdown: carveToMarkdown,
  plain: carveToPlainText,
  ansi: (source: string) => unstyled(carveToAnsi(source)),
}

for (const [name, render] of Object.entries(targets)) {
  describe(name, () => {
    it('keeps an unused definition with the existing definition newline convention', () => {
      expect(render('[lbl]: /u\n')).toBe('[lbl]: /u\n')
      expect(render('[^n]: %\n')).toBe(name === 'ansi' ? '[^n] %\n' : '[^n]: %\n')
      expect(render('*[A]: a\n')).toBe('*[A]: a\n')
    })

    it('keeps the title', () => {
      expect(render('[lbl]: /u "T"\n')).toBe('[lbl]: /u "T"\n')
    })

    it('keeps several unused definitions in document order', () => {
      const source = 'Before.\n\n[first]: /one\n[second]: /two "Two"\n\nBetween.\n\n[last]: /three\n\nAfter.\n'
      expect(render(source)).toBe('Before.\n\n[first]: /one\n\n[second]: /two "Two"\n\nBetween.\n\n[last]: /three\n\nAfter.\n')
    })

    it('keeps referenced definitions suppressed', () => {
      const source = '[lbl]: /u "T"\n\nSee [it][lbl].\n'
      const expected = name === 'markdown' ? 'See [it](/u "T").\n' : name === 'ansi' ? 'See it (/u).\n' : 'See it.\n'
      expect(render(source)).toBe(expected)
    })

    it('also treats a reference image as a use', () => {
      expect(render('[lbl]: /u\n\n![alt][lbl].\n')).not.toContain('[lbl]:')
    })

    it('keeps only the unused definition beside a referenced one', () => {
      const output = render('[used]: /u\n[unused]: /other\n\nSee [it][used].\n')
      expect(output).toContain('[unused]: /other\n')
      expect(output).not.toContain('[used]:')
    })
  })
}

it('retains the referenced Markdown corpus output', () => {
  const source = readFileSync(new URL('../spec/tests/corpus/16-reference-link-4.crv', import.meta.url), 'utf8')
  const expected = readFileSync(new URL('../spec/tests/corpus/16-reference-link-4.md', import.meta.url), 'utf8')
  expect(carveToMarkdown(source)).toBe(expected)
})

it.each([
  '[lbl]: /u "T"\n',
  '[lbl]: /u\\( "a \\"quoted\\" title"\n',
  '[lbl]: /a&copy; "a &copy; title"\n',
  '[lbl]: /u "a \\\\ title"\n',
])('reimports the Markdown definition without changing its destination or title: %j', source => {
  const definitions = (value: string) => parse(value).children.filter(node => node.type === 'link_reference_definition')
    .map(node => ({ label: node.label, href: node.href, title: node.title }))
  expect(definitions(migrateMarkdown(carveToMarkdown(source)).value)).toEqual(definitions(source))
  expect(definitions(source)).toHaveLength(1)
  expect(carveToPlainText(source)).toBe(renderCarve(parse(source)))
  expect(unstyled(carveToAnsi(source))).toBe(renderCarve(parse(source)))
})
