import { expect, it } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'

for (const base of ['\0DJOTSTRONG', '\0DJOTWORD', '\0DJOTORPHAN\0', '\0DJOTEMPTYTERM\0', '\0DJOTALT\0']) {
  for (const mode of ['overlap', 'leading-zero', 'long-run', 'reserved-series']) {
    it(`preserves user ${base.replaceAll('\0', '')} placeholders: ${mode}`, () => {
      const token = mode === 'overlap' ? base + '0\0' + base.slice(1) + '1\0' : mode === 'leading-zero' ? base + '00\0' : mode === 'long-run' ? base + '\0'.repeat(32768) : Array.from({ length: 128 }, (_, n) => base + n + '\0').join('')
      const source = token + ' w{x}{.c} ![*alt*](u)\n\na {.o} b\n\n{.orphan}\n\n: ```\n  payload\n  ```\n'
      const converted = djotToCarve(source)
      expect(converted).toContain(token)
      expect(converted.replaceAll(token, '')).not.toContain('\0DJOT')
      const html = carveToHtml(converted)
      expect(html).toContain('class="c"')
      expect(html).toContain('alt="alt"')
      expect(html).toContain('<dd>')
      expect(html).toContain('a  b')
    })
  }
}

it('preserves placeholder text in frontmatter', () => {
  const prefix = '---\nlabel: \0DJOTSTRONG0\0\n---\n\n'
  const converted = djotToCarve(prefix + '\0DJOTSTRONG0\0 w{x}{.c}')
  expect(converted.startsWith(prefix)).toBe(true)
  expect(converted).toContain('\0DJOTSTRONG0\0')
  expect(carveToHtml(converted)).toContain('class="c"')
})
