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
      it(`keeps quoted list payload after a lazy line following ${JSON.stringify(run)} at position ${lazyAfter} after ${JSON.stringify(first)}`, () => {
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
        const body = run.trimStart() === '```'
          ? `${indent}<code>\n${payload.join('\n')}\n[r]: /hidden</code>`
          : `${indent}~~~<br>\n${payload.join('<br>\n')}<br>\n[r]: /hidden`
        const expected = `<ul><li><blockquote><div class="line-block"><p>${firstHtml}<br>${body}</p></div></blockquote></li></ul><p>[t][r]</p>`
        const normalize = (html: string) => html.replace(/\s+</g, '<').replace(/>\s+/g, '>').trim()
        expect(normalize(carveToHtml(source))).toBe(normalize(expected))
      })
    }
  }
}
