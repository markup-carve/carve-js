import { describe, expect, it } from 'vitest'
import { carveToHtml, migrateMarkdown } from '../src/index.js'

const html = (carve: string): string => carveToHtml(carve).replace(/>\s+</g, '><').trim()

// markup-carve/carve#4929: CommonMark refuses the pointy autolink, so `<` is text,
// and the GFM extension then links the bare URL after it, `>` included.
// Expected HTML is native cmark-gfm 0.29.0.gfm.13 with `-e autolink`; its `%3E` is `&gt;` here.
describe('a pointy autolink refused for a control character keeps its GFM bare URL', () => {
  it.each([
    ['<http://\u0007>\n', '<[http://\u0007>](http://%07>)\n', '<p>&lt;<a href="http://%07&gt;">http://\u0007&gt;</a></p>'],
    ['<http://\u0007a.b>\n', '<[http://\u0007a.b>](http://%07a.b>)\n', '<p>&lt;<a href="http://%07a.b&gt;">http://\u0007a.b&gt;</a></p>'],
    ['a <http://\u000b> b\n', 'a <[http://\u000b>](http://%0B>) b\n', '<p>a &lt;<a href="http://%0B&gt;">http://\u000b&gt;</a> b</p>'],
    ['<http://\u0007\n', '<[http://\u0007](http://%07)\n', '<p>&lt;<a href="http://%07">http://\u0007</a></p>'],
    ['*<http://\u0001a.b/c>*\n', '/<[http://\u0001a.b/c>](http://%01a.b/c>)/\n', '<p><em>&lt;<a href="http://%01a.b/c&gt;">http://\u0001a.b/c&gt;</a></em></p>'],
    ['- <https://\u001f>\n', '- <[https://\u001f>](https://%1F>)\n', '<ul><li>&lt;<a href="https://%1F&gt;">https://\u001f&gt;</a></li></ul>'],
  ])('%j', (markdown, carve, expected) => {
    const migrated = migrateMarkdown(markdown).value
    expect(migrated).toBe(carve)
    expect(html(migrated)).toBe(expected)
  })
})
