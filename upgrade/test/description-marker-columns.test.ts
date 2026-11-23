import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../../build/engine-0.1/index.js'
import { render } from '../../src/index.ts'
import { canWriteUpgrade, upgrade } from '../src/index.ts'

describe('old description marker columns', () => {
  it('keeps a definition and its following sibling in their old owners', () => {
    const source = '- intro\n  :: term\n   : body\n\n    text\n'
    const result = upgrade(source)
    expect(result.output).toBe('- intro\n\n  :: term\n  : body\n\n  text\n')
    expect(canWriteUpgrade(result)).toBe(true)
    expect(result.records.map(({ entry }) => entry)).toContain('U-435')
  })

  it('preserves the interior indent of an already aligned sibling fence', () => {
    const source = '- intro\n  :: term\n   : body\n\n  ```\n    code\n  ```\n'
    const result = upgrade(source)
    expect(result.output).toContain('  ```\n    code\n  ```')
  })
  it.each([
    [':: t\n: x\n    - nested\n     - nested\ntail\n', ':: t\n: x\n    - nested\n    - nested\ntail\n'],
    [':: t\n:  [^f]: note\n    - nested\n     - nested\ntail\n', '[^f]: note\n\n:: t\n:  {%%}\n    - nested\n    - nested\ntail\n'],
  ])('moves a sibling marker of a description body list to the column of its list: %j', (source, output) => {
    const result = upgrade(source)
    expect(result.output).toBe(output)
    expect(result.check).toBe('pass')
    expect(result.records).toContainEqual(expect.objectContaining({ entry: 'U-023', line: 4 }))
    expect(render(result.output)).toBe(carveToHtml(source))
  })
})
