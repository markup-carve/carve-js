import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s).trim()
const bodyOf = (s: string): string => {
  const m = /<code[^>]*>([\s\S]*?)<\/code>/.exec(html(s))
  return m ? m[1]! : '<<no code block>>'
}

describe('an unterminated fence on a nested lead in a description body owns its body', () => {
  it('the reported document: the flush-left closer opens a fence of its own', () => {
    expect(html(':: t\n: - ``` x\ncode\n```\n')).toBe(
      [
        '<dl>',
        '  <dt>t</dt>',
        '  <dd>',
        '    <ul>',
        '      <li>',
        '        <pre><code class="language-x"></code></pre>',
        '      </li>',
        '    </ul>',
        '  </dd>',
        '</dl>',
        '<p>code</p>',
        '<pre><code></code></pre>',
      ].join('\n'),
    )
  })

  it('a tilde fence owns its body too', () => {
    expect(bodyOf(':: t\n: - ~~~ x\ncode\n~~~\n')).toBe('')
  })

  it('an info-less fence owns its body', () => {
    expect(bodyOf(':: t\n: - ```\ncode\n```\n')).toBe('')
  })

  it('a blank then a new term ends the body; the fence owns only what preceded it', () => {
    const out = html(':: t\n: - ``` x\ncode\n\n:: t2\n: plain\n')
    expect(out).toContain('<code class="language-x"></code></pre>')
    expect(out).toContain('<p>code</p>')
    expect(out).toContain('<dt>t2</dt>')
    expect(out).toContain('<dd>plain</dd>')
  })

  it('the outermost item spelling still leaks its body (control)', () => {
    // The leak is what this control watches; the payload is empty because
    // `CARVE-P12-064` gives an unclosed zero-line fence no line of its own.
    expect(bodyOf('- ``` x\ncode\n```\n')).toBe('')
  })

  it('the list-item host still owns its body (control, #1630)', () => {
    expect(bodyOf('- - ``` x\ncode\n```\n')).toBe('')
  })
})
