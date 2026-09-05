import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * AN UNTERMINATED FENCE ON A NESTED LEAD IN A DESCRIPTION BODY OWNS ITS BODY
 * (markup-carve/carve-js#1650, ruled on markup-carve/carve#1947 - the
 * description-body arm of carve#1900).
 *
 * A fence at an item's block start runs to the end of its container. When the
 * item sits inside a DESCRIPTION BODY, that body is the container that folds the
 * flush-left lines below the item in - so an unfinished fence on the item's lead
 * owns them, and a flush-left closing run among them is body text, not a closer.
 *
 * carve-js#1630 pinned this for the LIST-ITEM host; the description body records
 * its folded flush-left lines in the same `itemLazyLines` set the list collector
 * uses, so the item's fence-owns-its-body arm reads them on the reparse.
 */

const html = (s: string) => carveToHtml(s).trim()
const bodyOf = (s: string): string => {
  const m = /<code[^>]*>([\s\S]*?)<\/code>/.exec(html(s))
  return m ? m[1]! : '<<no code block>>'
}

describe('an unterminated fence on a nested lead in a description body owns its body', () => {
  it('the reported document: the fence owns code and the flush-left closer', () => {
    expect(html(':: t\n: - ``` x\ncode\n```\n')).toBe(
      [
        '<dl>',
        '  <dt>t</dt>',
        '  <dd>',
        '    <ul>',
        '      <li>',
        '        <pre><code class="language-x">code',
        '```',
        '</code></pre>',
        '      </li>',
        '    </ul>',
        '  </dd>',
        '</dl>',
      ].join('\n'),
    )
  })

  it('a tilde fence owns its body too', () => {
    expect(bodyOf(':: t\n: - ~~~ x\ncode\n~~~\n')).toBe('code\n~~~\n')
  })

  it('an info-less fence owns its body', () => {
    expect(bodyOf(':: t\n: - ```\ncode\n```\n')).toBe('code\n```\n')
  })

  it('a blank then a new term ends the body; the fence owns only what preceded it', () => {
    const out = html(':: t\n: - ``` x\ncode\n\n:: t2\n: plain\n')
    expect(out).toContain('>code\n</code></pre>')
    expect(out).toContain('<dt>t2</dt>')
    expect(out).toContain('<dd>plain</dd>')
  })

  /*
   * CONTROLS that must not move. The outermost single-item spelling has no
   * container above it, so nothing is folded in and the body leaks to the
   * document - the oracle does this too. The list-item host (#1630) already
   * owns its body.
   */
  it('the outermost item spelling still leaks its body (control)', () => {
    expect(bodyOf('- ``` x\ncode\n```\n')).toBe('\n')
  })

  it('the list-item host still owns its body (control, #1630)', () => {
    expect(bodyOf('- - ``` x\ncode\n```\n')).toBe('code\n```\n')
  })
})
