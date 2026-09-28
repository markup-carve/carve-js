import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToCarve } from '../src/index.js'

// markup-carve/carve-js#2245, PART 11 §2 (CARVE-P11-006): an escape is written
// only where omitting it would change the re-parse. An image opens on ONE `!`
// before a bracket, so in a run of them only the last one opens anything - the
// ones before it sit against the backslash that guards their neighbour. The
// occurrence search escaped the whole run, because a run is §2's unit where the
// construct opens on a run (`\#\# H`), and `!` is not such a construct.
const imported = (html: string): string => htmlToCarve(html).value

describe('a bang run before a bracket escapes only its opener', () => {
  it.each([
    ['the reported shape', '<p>!!<a href="/v">u</a></p>', '!\\![u](/v)\n'],
    ['a longer run', '<p>!!!<a href="/v">u</a></p>', '!!\\![u](/v)\n'],
    ['two runs in one paragraph', '<p>!!<a href="/v">u</a> and !<a href="/w">t</a></p>', '!\\![u](/v) and \\![t](/w)\n'],
    // CONTROLS. Each of these needs its escape, or needs none at all, and a fix
    // that stopped escaping the opener would satisfy the rows above while
    // breaking one of these.
    ['a lone bang before a link still escapes', '<p>!<a href="/v">u</a></p>', '\\![u](/v)\n'],
    ['a bang before an image needs none', '<p>!<img src="/v" alt="u"></p>', '!![u](/v)\n'],
    ['a bang run before plain text needs none', '<p>!!plain text</p>', '!!plain text\n'],
    ['a bang run before a code span', '<p>!!<code>c</code></p>', '!\\!`c`\n'],
  ])('%s', (_name, html, carve) => {
    expect(imported(html)).toBe(carve)
    expect(carveToHtml(carve)).toBe(html)
    expect(carveToCarve(carve)).toBe(carve)
  })
})
