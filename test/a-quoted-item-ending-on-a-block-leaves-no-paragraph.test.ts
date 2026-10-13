import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a quoted item ending on a block leaves no paragraph', () => {
  it('ends the quote after an empty container in a dedented sibling', () => {
    const source = ['>   - a', '> - b', '>     - c', '>   :::', '1. lazy'].join('\n')
    expect(carveToHtml(source)).toBe(`<blockquote>
  <ul>
    <li>a</li>
  </ul>
  <ul>
    <li>b
      <ul>
        <li>c</li>
      </ul>
      <div>

      </div>
    </li>
  </ul>
</blockquote>
<ol>
  <li>lazy</li>
</ol>`)
  })

  it.each(['    ', '      ', '\t\t'])('ends the quote after a heading at or past the nested item column (%j)', indent => {
    const source = ['> - b', '>   - c', `> ${indent}# h`, 'tail'].join('\n')
    expect(carveToHtml(source)).toBe(`<blockquote>
  <ul>
    <li>b
      <ul>
        <li>c
          <h1 id="h">h</h1>
        </li>
      </ul>
    </li>
  </ul>
</blockquote>
<p>tail</p>`)
  })

  it.each(['| t |', '# h'])('ends the quote after %s following a marker-line footnote', block => {
    const source = ['> - [^n]: text', '>     more', `>     ${block}`, 'after', '', '[^n]'].join('\n')
    const lastBlock = block === '# h' ? '      <h1 id="h">h</h1>' : `      <table>
        <tbody>
          <tr><td>t</td></tr>
        </tbody>
      </table>`
    expect(carveToHtml(source)).toBe(`<blockquote>
  <ul>
    <li>
${lastBlock}
    </li>
  </ul>
</blockquote>
<p>after</p>
<p><a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>
<section role="doc-endnotes" aria-label="Footnotes">
  <hr>
  <ol>
    <li id="fn1">
      <p>text
more<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
  </ol>
</section>`)
  })

  it('ends the quote after a link definition following a marker-line footnote', () => {
    const source = ['> - [^n]: text', '>     more', '>     [r]: /u', 'tail'].join('\n')
    expect(carveToHtml(source)).toBe(`<blockquote>
  <ul>
    <li></li>
  </ul>
</blockquote>
<p>tail</p>`)
  })

  it.each([[[]], [['>     # h']]])('preserves the marker-line definition term (%j)', lines => {
    const source = ['> - :: t', ...lines, 'tail'].join('\n')
    const term = lines.length ? 't\n  # h\ntail' : 't\ntail'
    expect(carveToHtml(source)).toBe(`<blockquote>
  <ul>
    <li>
      <dl>
        <dt>${term}</dt>
      </dl>
    </li>
  </ul>
</blockquote>`)
  })
})
