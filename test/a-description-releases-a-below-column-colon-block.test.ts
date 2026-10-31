import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const source = (follower: string): string => `:: term
:  definition
   ::: note
   body
  :::
${follower}
`

const firstBlock = `<dl>
  <dt>term</dt>
  <dd>
    <p>definition</p>
    <aside class="admonition note" aria-label="Note">
      <p>body</p>
    </aside>
  </dd>
</dl>`

describe('a colon run below a description body', () => {
  it('opens a sibling div with a paragraph follower', () => {
    expect(carveToHtml(source('tail')).trim()).toBe(`${firstBlock}
<div>
  <p>tail</p>
</div>`)
  })

  it('opens a sibling div with a code follower', () => {
    expect(carveToHtml(source('```\ntail')).trim()).toBe(`${firstBlock}
<div>
  <pre><code>tail
</code></pre>
</div>`)
  })
})
