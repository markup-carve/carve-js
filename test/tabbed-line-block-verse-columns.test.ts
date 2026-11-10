import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToHtml } from '../src/index.js'

describe('tabbed line block verse columns after owner frames', () => {
  it('restarts a tab after each nested item cut, matching the space spelling', () => {
    const tabbed = '* a\n  * a\n  \t::: |\n    \ty\n  \t:::\n'
    const spaced = '* a\n  * a\n      ::: |\n        y\n      :::\n'
    expect(carveToHtml(tabbed)).toBe(carveToHtml(spaced))
    expect(carveToHtml(tabbed)).toContain('<p>&nbsp;&nbsp;y</p>')
  })

  it('uses the nested item fence column after a partly consumed tab', () => {
    expect(carveToHtml('* a\n  * a\n   \t::: |\n  \ty\n   \t:::\n')).toBe(`<ul>
  <li>a
    <ul>
      <li>a
        <div class="line-block">
          <p>y</p>
        </div>
      </li>
    </ul>
  </li>
</ul>`)
  })

  it('preserves only the verse column beyond a quoted nested fence', () => {
    expect(carveToHtml('> - a\n>   - a\n>   \t::: |\n>     \t z\n>   \t:::\n')).toBe(`<blockquote>
  <ul>
    <li>a
      <ul>
        <li>a
          <div class="line-block">
            <p>&nbsp;&nbsp;&nbsp;z</p>
          </div>
        </li>
      </ul>
    </li>
  </ul>
</blockquote>`)
  })

  it('retains the second tab residual inside the final frame', () => {
    expect(carveToHtml('> - a\n>   - a\n>   \t::: |\n> \t\tz\n>   \t:::\n')).toBe(`<blockquote>
  <ul>
    <li>a
      <ul>
        <li>a
          <div class="line-block">
            <p>&nbsp;&nbsp;z</p>
          </div>
        </li>
      </ul>
    </li>
  </ul>
</blockquote>`)
  })

  it('compares a quoted tabbed opener with a space-led verse inside the quote', () => {
    expect(carveToHtml('> - b\n> \t::: |\n>       text\n>   ::: |\n')).toBe(`<blockquote>
  <ul>
    <li>b
      <div class="line-block">
        <p>&nbsp;&nbsp;text<br>
::: |</p>
      </div>
    </li>
  </ul>
</blockquote>`)
  })

  it('uses the innermost quote columns for a nested quoted item', () => {
    expect(carveToHtml('> > - a\n> > \t::: |\n> >       xyz\n> > \t:::\n')).toBe(`<blockquote>
  <blockquote>
    <ul>
      <li>a
        <div class="line-block">
          <p>&nbsp;&nbsp;xyz</p>
        </div>
      </li>
    </ul>
  </blockquote>
</blockquote>`)
  })

  it('keeps source offsets on the authored verse words', () => {
    for (const source of [
      '* a\n  * a\n   \t::: |\n  \ty\n   \t:::\n',
      '> - a\n>   - a\n>   \t::: |\n>     \t z\n>   \t:::\n',
      '> - a\n>   - a\n>   \t::: |\n> \t\tz\n>   \t:::\n',
    ]) {
      const words: Array<{ value: string, pos?: { startOffset: number, endOffset: number } }> = []
      const visit = (node: unknown): void => {
        if (Array.isArray(node)) node.forEach(visit)
        else if (node !== null && typeof node === 'object') {
          const record = node as Record<string, unknown>
          if (record.type === 'text') words.push(record as typeof words[number])
          for (const [key, value] of Object.entries(record)) if (key !== 'pos') visit(value)
        }
      }
      visit(carveToAstJson(source))
      const verseWord = words.find((word) => word.value === 'y' || word.value === 'z')
      expect(verseWord?.pos).toBeDefined()
      expect(source.slice(verseWord!.pos!.startOffset, verseWord!.pos!.endOffset)).toBe(verseWord!.value)
    }
  })
})
