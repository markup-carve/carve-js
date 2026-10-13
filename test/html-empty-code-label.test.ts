import { expect, it } from 'vitest'
import { carveToHtml, htmlToAst, htmlToCarve, parse } from '../src/index.js'

it.each(['safe', 'semantic', 'roundtrip'] as const)('reads empty code labels in %s', mode => {
  const source = '```php []\necho 1;\n```\n'
  const html = carveToHtml(source, { roundtrip: true })
  expect(htmlToAst(html, { mode }).value.children[0]).toMatchObject({ type: 'code_block', lang: 'php', label: '' })
  expect(parse(htmlToCarve(html, { mode }).value).children[0]).toMatchObject({ label: '' })
})

it.each(['bad]label', 'line&#10;label', 'line&#13;label'])('refuses invalid code label %s', label => {
  const html = `<pre data-carve-label="${label}"><code>x\n</code></pre>`
  expect(htmlToAst(html).value.children[0]).not.toHaveProperty('label')
})
