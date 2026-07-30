import { describe, expect, it } from 'vitest'
import { carveToHtml, carveToMarkdown } from '../src/index.js'

/**
 * A fence's title can come from the header or from an attribute line above it,
 * and the attribute line wins. The HTML target uses the winner, so emitting the
 * authored header in the Markdown info string described the same document
 * differently in the two targets - announcing a title that had lost
 * (carve#352, corpus 11-fenced-code-10).
 *
 * The parser already resolves the override into `attrs`, so no new information is
 * needed.
 */
const infoString = (src: string): string => carveToMarkdown(src).split('\n')[0] ?? ''

describe('the Markdown fence info string carries the effective title', () => {
  it('keeps a title written in the header', () => {
    expect(infoString('``` "notes.txt"\nremember the milk\n```\n')).toBe('``` "notes.txt"')
  })

  it('prefers an attribute line over the header', () => {
    const src = '{title="from the attribute line"}\n```php "from the header"\ncode\n```\n'
    expect(infoString(src)).toBe('```php "from the attribute line"')
  })

  it('agrees with what the HTML target says the title is', () => {
    const src = '{title="from the attribute line"}\n```php "from the header"\ncode\n```\n'
    expect(carveToHtml(src)).toContain('title="from the attribute line"')
    expect(infoString(src)).toContain('from the attribute line')
  })

  it('emits no title when there is none', () => {
    expect(infoString('```php\ncode\n```\n')).toBe('```php')
  })

  it('keeps a grouping label alongside the title', () => {
    expect(infoString('```php "f.php" [Build]\ncode\n```\n')).toBe('```php "f.php" [Build]')
  })
})
