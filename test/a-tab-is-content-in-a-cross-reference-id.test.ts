import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a tab is content in a cross-reference id', () => {
  it('keeps one unresolved reference literal without parsing its interior', () => {
    const source = ['a </#no\tpe> b', '', 'c </#no\t*pe*> d'].join('\n')
    expect(carveToHtml(source)).toBe('<p>a &lt;/#no\tpe&gt; b</p>\n<p>c &lt;/#no\t*pe*&gt; d</p>')
  })

  it('takes the same literal path as a form feed', () => {
    const source = ['a </#no\fpe> b', '', 'a </#no\tpe> b'].join('\n')
    expect(carveToHtml(source)).toBe('<p>a &lt;/#no\fpe&gt; b</p>\n<p>a &lt;/#no\tpe&gt; b</p>')
  })
})
