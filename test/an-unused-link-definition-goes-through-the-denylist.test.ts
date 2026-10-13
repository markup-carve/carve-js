import { describe, expect, it } from 'vitest'
import { carveToAnsiWithReport, carveToMarkdownWithReport, carveToPlainTextWithReport, migrateMarkdown } from '../src/index.js'

const unstyled = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, '')
const targets = {
  markdown: carveToMarkdownWithReport,
  plain: carveToPlainTextWithReport,
  ansi: carveToAnsiWithReport,
}
const blanked = { markdown: '[lbl]: <>\n', plain: '[lbl]:\n', ansi: '[lbl]: \n' }

for (const [name, render] of Object.entries(targets)) {
  describe(name, () => {
    it.each([
      '[lbl]: javascript:alert(3)\n',
      '[lbl]: JavaScript:alert(3)\n',
      '[lbl]: vbscript:x\n',
    ])('blanks a denied destination and reports it: %j', source => {
      const { value, losses } = render(source)
      expect(unstyled(value)).toBe(blanked[name as keyof typeof blanked])
      expect(losses.map(loss => [loss.code, loss.target])).toEqual([['destination-denied', name]])
    })

    it('keeps the title of a blanked definition', () => {
      expect(unstyled(render('[lbl]: javascript:x "T"\n').value)).toContain('"T"')
    })

    it('leaves an allowed destination and reports nothing', () => {
      const { value, losses } = render('[lbl]: https://e.com/u "T"\n')
      expect(unstyled(value)).toBe('[lbl]: https://e.com/u "T"\n')
      expect(losses).toEqual([])
    })
  })
}

it('reimports the blanked Markdown line as a definition with no destination', () => {
  const markdown = carveToMarkdownWithReport('[lbl]: javascript:alert(3)\n').value
  expect(migrateMarkdown(markdown).value).not.toContain('javascript')
})
