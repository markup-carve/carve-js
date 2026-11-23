import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../../build/engine-0.1/index.js'
import { render } from '../../src/index.ts'
import { upgrade } from '../src/index.ts'

describe('U-038: a definition moved above the document', () => {
  it.each([
    ['\n::::\n- > para\n  > [^f]: n\n  >   - sub\ntail[^f]\n', '[^f]: n\n  - sub\ntail[^f]\n\n\n::::\n- > para\n'],
    [':: t\n:  [^f]: note\n     - nested\ntail\n', '[^f]: note\n  - nested\ntail\n\n:: t\n:  {%%}\n'],
  ])('cuts its lines even where an earlier rule edited inside them: %j', (source, output) => {
    const result = upgrade(source)
    expect(result.output).toBe(output)
    expect(result.check).toBe('pass')
    expect(render(result.output)).toBe(carveToHtml(source))
  })
})
