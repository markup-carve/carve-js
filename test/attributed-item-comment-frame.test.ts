import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each(['a', '1', 'iv'])('keeps a comment opener at the %s item body column', (marker) => {
  const source = `${marker}.{}  .\n${' '.repeat(marker.length + 3)}%%%\nc\n`
  const list = marker === 'a' ? '<ol type="a">' : marker === 'iv' ? '<ol type="i" start="4">' : '<ol>'
  expect(carveToHtml(source)).toBe(`${list}\n  <li>.</li>\n</ol>\n<p>c</p>`)
})
