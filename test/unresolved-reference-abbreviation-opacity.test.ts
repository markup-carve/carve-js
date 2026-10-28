import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each([
  ['plain', '[x][m] ![x][m] [m]'],
  ['in a quote', '> [x][m] ![x][m] [m]'],
  ['in a list', '- [x][m] ![x][m] [m]'],
])('keeps unresolved reference literals opaque %s', (_name, body) => {
  const html = carveToHtml(`*[m]: y\n\n${body}\n`)
  expect(html).toContain('[x][m] ![x][m] [<abbr title="y">m</abbr>]')
})
