import { describe, expect, it } from 'vitest'
import { carveToMarkdown } from '../src/index.js'

/**
 * A fence title needs a language in front of it.
 *
 * In Markdown the info string's FIRST TOKEN is the language, so
 * ` ``` "notes.txt" ` makes a CommonMark reader emit
 * `class="language-&quot;notes.txt&quot;"` - measured against commonmark.js, not
 * assumed. Markdown has no way to express a fence title on its own, so dropping
 * it beats emitting a bogus language class.
 *
 * With a language present the title is ignored by every consumer and rides along
 * safely, which is why it is kept there. carve-php had this guard and was right
 * about it (carve#352, corpus 11-fenced-code-8).
 */
const infoString = (src: string): string => carveToMarkdown(src).split('\n')[0] ?? ''

describe('a Markdown fence title needs a language', () => {
  it('drops a title that has no language in front of it', () => {
    expect(infoString('``` "notes.txt"\nremember the milk\n```\n')).toBe('```')
  })

  it('keeps a title when a language precedes it', () => {
    expect(infoString('```php "notes.php"\ncode\n```\n')).toBe('```php "notes.php"')
  })

  it('still keeps a grouping label without a language', () => {
    // A label is bracketed, so it cannot be mistaken for a language token.
    expect(infoString('``` [Build]\ncode\n```\n')).toBe('``` [Build]')
  })

  it('keeps language, title and label together', () => {
    expect(infoString('```php "f.php" [Build]\ncode\n```\n')).toBe('```php "f.php" [Build]')
  })
})
