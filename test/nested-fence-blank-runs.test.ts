import {expect, it} from 'vitest'
import {carveToCarve, carveToHtml} from '../src/index.js'

it('keeps every trailing blank in an unfinished nested fence', () => {
  for (const fence of ['```', '~~~']) for (const blanks of [1, 2, 3]) {
    for (const depth of [0, 1, 2, 3]) for (const tail of ['out', '# Heading', '- next', '']) {
      let source = `- head\n\n   ${fence}\n   body\n${'\n'.repeat(blanks)}${tail}\n`
      for (let i = 0; i < depth; i++) source = '- parent\n' + source.split('\n').slice(0, -1).map((line) => '  ' + line).join('\n') + '\n'
      const html = carveToHtml(source)
      expect(html, source).toContain(`body\n${'\n'.repeat(blanks + (tail === '' ? 1 : 0))}</code></pre>`)
      const formatted = carveToCarve(source)
      expect(carveToHtml(formatted), source).toBe(html)
      expect(carveToCarve(formatted), source).toBe(formatted)
    }
  }
})

it('does not move spacing after a closed fence into its payload', () => {
  const source = '- parent\n  - head\n\n     ```\n     body\n     ```\n\n\n  out\n'
  expect(carveToHtml(source)).toContain('<pre><code>body\n</code></pre>')
})

it('retains blanks when the fence is inside a marker-line child', () => {
  const source = '- - head\n\n     ```\n     body\n\n\n'
  const html = carveToHtml(source)
  expect(html).toContain('body\n\n\n</code></pre>')
  expect(carveToHtml(carveToCarve(source))).toBe(html)
})

it('keeps raw-fence blanks and whitespace past the authored column', () => {
  expect(carveToHtml('- head\n\n   ```=html\n   body\n\n\nout\n')).toContain('body\n\n\n')
  expect(carveToHtml('- parent\n  - head\n\n     ```\n     body\n       \n  out\n')).toContain('body\n  \n</code></pre>')
})
