import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

for (const [prefix, lazy, first] of [
  ['> ', 'lazy', 'verse'],
  ['> ', 'lazy', '  indented verse'],
  ['> > ', '> lazy', 'verse'],
]) {
  it(`keeps lazy payload inside ${JSON.stringify(prefix)} after ${JSON.stringify(first)}`, () => {
    const source = [
      `${prefix}::: |`,
      prefix + first,
      lazy,
      `${prefix}more`,
      `${prefix}[r]: /hidden`,
      `${prefix}:::`,
      '',
      '[t][r]',
    ].join('\n')
    const indentation = first.startsWith('  ') ? '&nbsp;&nbsp;' : ''
    const lineBlock = `<div class="line-block">\n${prefix === '> > ' ? '    ' : '  '}  <p>${indentation}${first.trimStart()}<br>\nlazy<br>\nmore<br>\n[r]: /hidden</p>`
    const html = carveToHtml(source)
    expect(html).toContain(lineBlock)
    expect(html).toContain('<p>[t][r]</p>')
    expect(html).not.toContain('href="/hidden"')
  })
}

it('resumes lazy payload after a paired run past the quote content column', () => {
  const source = [
    '> ::: |',
    '> verse',
    '>  ```',
    '> :::',
    '>   ```',
    'lazy',
    '> more',
    '> :::',
  ].join('\n')
  expect(carveToHtml(source)).toBe(`<blockquote>
  <div class="line-block">
    <p>verse<br>
&nbsp;<code>
:::
&nbsp;&nbsp;</code><br>
lazy<br>
more</p>
  </div>
</blockquote>`)
})

for (const first of ['verse', '  indented verse']) {
  for (const run of [' ```', '  ```', '  ~~~']) {
    for (const lazyAfter of [0, 1, 2]) {
      it(`ends quoted list payload at a lazy line after ${JSON.stringify(run)} at position ${lazyAfter} following ${JSON.stringify(first)}`, () => {
        const payload = ['inside', 'more']
        payload.splice(lazyAfter, 0, 'lazy')
        const source = [
          '- > ::: |',
          '  > ' + first,
          '  > ' + run,
          ...payload.map(line => line === 'lazy' ? line : '  > ' + line),
          '  > [r]: /hidden',
          '  > :::',
          '',
          '[t][r]',
        ].join('\n')
        const firstHtml = first.startsWith('  ') ? '&nbsp;&nbsp;indented verse' : first
        const indent = '&nbsp;'.repeat(run.length - run.trimStart().length)
        const lines = payload.slice(0, lazyAfter + 1)
        const rest = payload.slice(lazyAfter + 1)
        const body = run.trimStart() === '```'
          ? `${indent}<code>${lines.join('\n')}</code>`
          : `${indent}~~~<br>${lines.join('<br>')}`
        const quote = `<blockquote>${rest.length ? `<p>${rest.join('\n')}</p>` : ''}<div></div></blockquote>`
        const expected = `<ul><li><blockquote><div class="line-block"><p>${firstHtml}<br>${body}</p></div></blockquote></li></ul>${quote}<p><a href="/hidden">t</a></p>`
        const normalize = (html: string) => html.replace(/\s+</g, '<').replace(/>\s+/g, '>').trim()
        expect(normalize(carveToHtml(source))).toBe(normalize(expected))
      })
    }
  }
}
