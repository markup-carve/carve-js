import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../../build/engine-0.1/index.js'
import { render } from '../../src/index.ts'
import { upgrade } from '../src/index.ts'

// 0.1 ends a fence that its indented closer did not close at the first column of the next block's line.
describe('U-014, U-049: a fence attached with + that 0.1 ran past its indented closer', () => {
  it.each([
    ['[^f]: n\n+\n```\na\n ```\n\n- see[^f]\n', '[^f]: n\n\n      ````\n      a\n       ```\n\n      ````\n- see[^f]\n'],
    ['- item\n+\n```\na\n ```\n\npara\n', '- item\n\n  ````\n  a\n   ```\n\n  ````\npara\n'],
    ['[^f]: n\n+\n```\na\n[^f]: t\n[^z]: zz\nb\n ```\n\n- see[^f]\n',
      '[^f]: n\n\n      ````\n      a\n      [^f]: t\n      [^z]: zz\n      b\n       ```\n\n      ````\n- see[^f]\n'],
  ])('indents only the lines of the block, and the closer with them: %j', (source, output) => {
    const result = upgrade(source)
    expect(result.output).toBe(output)
    expect(result.check).toBe('pass')
    expect(render(result.output)).toBe(carveToHtml(source))
  })
})
