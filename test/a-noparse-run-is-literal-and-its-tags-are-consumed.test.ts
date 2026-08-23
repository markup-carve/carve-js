import { describe, it, expect } from 'vitest'
import { bbcodeToCarve, carveToHtml } from '../src/index.js'

/**
 * carve-js#1368: the BBCode importer had no rule for `[noparse]`.
 *
 * The closing tag was consumed by the leftover-tag cleanup and the OPENING tag
 * survived as literal text, so a migrated post carried a stray `[noparse]` -
 * a construct Carve does not have, in a document nobody wrote it into. It is
 * the standard phpBB / vBulletin spelling for "leave this literal", which
 * makes it exactly the tag a forum export is most likely to carry around
 * content that would otherwise be rewritten.
 *
 * carve-php `BbcodeToCarve` is the reference: it consumes the tags and hides
 * the content from every later pass.
 */
describe('a noparse run is literal and its tags are consumed', () => {
  it('consumes both tags and leaves the escaped text', () => {
    // The content is escaped exactly as ordinary text is - it goes through the
    // plain escaper before the stash, so the asterisks are neutralized once and
    // not twice. Escaping it a second time would write a literal backslash
    // BESIDE the bold it was meant to prevent.
    expect(bbcodeToCarve('[noparse]*x*[/noparse]')).toBe('\\*x*\n')
    expect(carveToHtml(bbcodeToCarve('[noparse]*x*[/noparse]'))).toBe('<p>*x*</p>')
  })

  it('keeps enclosed BBCode literal instead of converting it', () => {
    // The point of the tag. Before this, the run was invisible to the importer,
    // so the tags inside it were converted like any others and only the stray
    // `[noparse]` was left to show something had gone wrong.
    expect(bbcodeToCarve('[noparse][b]x[/b][/noparse]')).toBe('[b]x[/b]\n')
    expect(bbcodeToCarve('before [noparse][i]y[/i][/noparse] after')).toBe(
      'before [i]y[/i] after\n',
    )
    expect(bbcodeToCarve('[noparse]a [url]http://e.com[/url] b[/noparse]')).toBe(
      'a [url]http://e.com[/url] b\n',
    )
  })

  it('leaves an unpaired opener alone', () => {
    // No closer, no run: an unbalanced tag is text, which is what an unknown
    // tag already gets. carve-php answers the same.
    expect(bbcodeToCarve('[noparse]unclosed')).toBe('[noparse]unclosed\n')
  })

  it('writes no private-use character when the runs nest', () => {
    // The stash key is drawn from the private-use area, and the two families
    // are stashed in turn, so a `[noparse]` body can hold a key of its own. One
    // restore pass walks PAST the key it just spliced in - carve-php restores
    // in one pass and emits the raw U+E010 pair for this exact input, which is
    // a defect rather than a shape to copy.
    const nested = bbcodeToCarve('[noparse][code]x[/code][/noparse]')
    expect(nested).toBe('[code]x[/code]\n')
    expect(/[\ue000-\uf8ff]/u.test(nested)).toBe(false)
  })
})

describe('a code run is literal for the whole pipeline', () => {
  it('shows the markup it encloses instead of converting it', () => {
    // Showing markup is most of what a forum uses `[code]` for, and the
    // enclosed tags were being rewritten by every pass below the escaper -
    // neither what the author wrote nor BBCode. Found while building the stash
    // `[noparse]` needs; carve-php answered it as carve-php#1206.
    expect(bbcodeToCarve('[code][b]not bold[/b][/code]')).toBe('```\n[b]not bold[/b]\n```\n')
    expect(bbcodeToCarve('[c][b]x[/b][/c]')).toBe('`[b]x[/b]`\n')
    expect(bbcodeToCarve('[code][noparse]y[/noparse][/code]')).toBe(
      '```\n[noparse]y[/noparse]\n```\n',
    )
  })

  it('still trims the fenced body to the code itself', () => {
    // The trim moved to the stash rather than being lost: `convertCode` fences
    // `body.trim()`, and once the body is a key there is nothing left for that
    // trim to find. carve-php trims in the same place and does not, so its own
    // output for this input carries a blank line above and below the code.
    expect(bbcodeToCarve('[code=php]\n$x = 1;\n[/code]')).toBe('```php\n$x = 1;\n```\n')
    expect(bbcodeToCarve('[code]\na\n[/code]')).toBe('```\na\n```\n')
  })

  it('keeps the raw-HTML guard, with the language read past the stash', () => {
    // `[code= =html]` must not mint a Carve `=html` raw-HTML block, which would
    // be live HTML under the default renderer. The language sits in the OPENING
    // tag, which the stash leaves visible, so the guard still reads it.
    expect(bbcodeToCarve('[code= =html]\n<b>x</b>\n[/code]')).not.toContain('```=html')
  })
})
