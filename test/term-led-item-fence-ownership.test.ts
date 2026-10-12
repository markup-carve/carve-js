import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const normalized = (source: string) => carveToHtml(source)
  .replace(/>\s+</g, '><').trim()

it('ends a later content-column fence before an unadmitted tail', () => {
  const source = [
    '- :: term',
    '     %% hidden',
    '  ```',
    '  code',
    'after',
    '',
  ].join('\n')
  expect(normalized(source)).toBe(
    '<ul><li><dl><dt>term\n</dt></dl><pre><code>code\n</code></pre></li></ul><p>after</p>',
  )
})

it('ends the item after a closed nested description marker fence', () => {
  const source = [
    '- :: t',
    '  : - ```',
    '      code',
    '      ```',
    'after',
    '',
  ].join('\n')
  expect(normalized(source)).toBe(
    '<ul><li><dl><dt>t</dt><dd><ul><li><pre><code>code\n</code></pre></li></ul></dd></dl></li></ul><p>after</p>',
  )
})

it('keeps the host fence after a nested description marker fence', () => {
  const source = [
    '- :: t',
    '  : - ```',
    '  ```',
    'after',
    '',
  ].join('\n')
  expect(normalized(source)).toBe(
    '<ul><li><dl><dt>t</dt><dd><ul><li><pre><code></code></pre></li></ul></dd></dl><pre><code>after\n</code></pre></li></ul>',
  )
})
