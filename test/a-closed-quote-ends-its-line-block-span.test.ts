import { expect, it } from 'vitest'
import { carveToHtml, parse, renderHtml } from '../src/index.js'

// A lazy line ends the quote, so a line block's open span cannot reach the next quote (carve#5062).
for (const host of [['> - ', '>   '], ['> ', '> '], ['> > - ', '> >   ']] as const) {
  for (const run of ['```', '~~~']) {
    it(`ends the line block span with its quote: ${JSON.stringify(host[0])} ${run}`, () => {
      const source = `${host[0]}::: |\n${host[1]}${run}\n${host[1]}:::\nlazy\n>   ${run}\n>   x\n`
      for (const html of [carveToHtml(source), renderHtml(parse(source))]) {
        expect(html).toMatch(/<div class="line-block">/)
        expect(html).toMatch(/<p>lazy<\/p>\n<blockquote>\n {2}<pre><code>x\n<\/code><\/pre>\n<\/blockquote>\n?$/)
      }
    })
  }
}

// A quote that an item, a note or a quoted item hosts looks for the span's closer in its own lines.
for (const [open, cont] of [['- > ', '  > '], ['[^n]: > ', '  > '], ['> - > ', '>   > ']] as const) {
  it(`opens no line block span without a closer in its quote: ${JSON.stringify(open)}`, () => {
    const source = `see[^n]\n\n${open}::: |\n${cont}\`\`\`\n${cont}:::\nlazy\n`
    for (const html of [carveToHtml(source), renderHtml(parse(source))]) {
      expect(html).toMatch(/<div class="line-block">\n\s*<p><code><\/code><\/p>\n\s*<\/div>/)
      expect(html).toMatch(/<\/(?:ul|blockquote)>\n<p>lazy<\/p>|<\/p>\n<p>lazy<\/p>\n<section/)
    }
  })
}
