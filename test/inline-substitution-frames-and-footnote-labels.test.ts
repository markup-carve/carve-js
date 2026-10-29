import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { rawImageBracketRunCloses } from '../src/parse/inline/parse-brackets.js'

const html = (source: string) => carveToHtml(source).trim()

// PART 9 E2a and section 22: a matched `{+ +}` or `{- -}` frame hides its `~>` (carve-js#3902).
describe('a substitution arrow inside an insertion or deletion frame is the frame\'s', () => {
  it.each([
    ['{~{+b~>c+}~>a~}', '<p><del><ins>b~&gt;c</ins></del><ins>a</ins></p>'],
    ['{~{-b~>c-}~}', '<p><s><del>b~&gt;c</del></s></p>'],
    ['{~a~>{+b~>c+}~}', '<p><del>a</del><ins><ins>b~&gt;c</ins></ins></p>'],
    ['{~x{-b~>c-}y~>a~}', '<p><del>x<del>b~&gt;c</del>y</del><ins>a</ins></p>'],
    ['{~{+b~>c~>a~}', '<p><del>{+b</del><ins>c~&gt;a</ins></p>'],
    ['{~{+b~>c+}{.k}~>a~}', '<p><del><ins class="k">b~&gt;c</ins></del><ins>a</ins></p>'],
    ['- {~{-b~>c-}~>a~}', '<ul>\n  <li><del><del>b~&gt;c</del></del><ins>a</ins></li>\n</ul>'],
  ])('%s', (source, expected) => expect(html(source)).toBe(expected))
})

// PART 8: a `[^` run is a footnote reference before bracket scanning, and its
// label may hold `[` (carve-js#3903).
describe('a footnote label holding a bracket opens no bracket run', () => {
  it.each([
    ['/[^[g]/] b/', '<p><em>[^[g]</em>] b/</p>'],
    ['*[^[g]*] b*', '<p><strong>[^[g]</strong>] b*</p>'],
    ['_a [^x[y] b_', '<p><u>a [^x[y] b</u></p>'],
    ['=[^[g]x]=] b=', '<p><mark>[^[g]x]</mark>] b=</p>'],
    ['[x [^[g] y](u)', '<p>[x [^[g] y](u)</p>'],
    ['[/[^[g/] b/](u)', '<p>[<em>[^[g/] b</em>](u)</p>'],
    ['/![^[[g]/] b/', '<p><em>![^[[g]</em>] b/</p>'],
    ['/x![^[[g][r]/] b/', '<p><em>x![^[[g][r]</em>] b/</p>'],
    ['/![^[g]/](i.png) b/', '<p><em><img src="i.png" alt="^[g]/"> b</em></p>'],
    ['![^x[y](i.png)', '<p>![^x[y](i.png)</p>'],
    ['/^[^[[g]/] b/', '<p><em>^[^[[g]</em>] b/</p>'],
  ])('%s', (source, expected) => expect(html(source)).toBe(expected))

  it('closes after a resolved reference', () => {
    expect(html('[^[g]: note\n\n/[^[g]/] b/')).toMatch(/^<p><em><a id="fnref1"[^>]*><sup>1<\/sup><\/a><\/em>\] b\/<\/p>/)
  })

  it.each([
    ['/^[^[g]/] b/', '<p><em><a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a> b</em></p>'],
    ['{^[^[g]/] b/', '<p>{<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a> b/</p>'],
  ])('leaves an inline note opener %s to the note', (source, expected) => {
    expect(html(source).split('\n')[0]).toBe(expected)
  })

  // The #3917 ruling for the insertion and deletion scans (markup-carve/carve#3925).
  it.each([
    ['{+[^[g]+}] b+}', '<p><ins>[^[g]</ins>] b+}</p>'],
    ['{-[^[g]-}] b-}', '<p><del>[^[g]</del>] b-}</p>'],
  ])('%s', (source, expected) => expect(html(source)).toBe(expected))

  // PART 9 §16 turns note recognition off inside an inline note, so the run is a bracket run there.
  it('keeps a bracket run inside an inline note', () => {
    expect(html('x ^[/[^[g]/] b/]')).toContain('<p><em>[^[g]/] b</em><a href="#fnref1"')
  })

  it('closes an image alt only where the image forms', () => {
    expect(rawImageBracketRunCloses('^x')).toBe(true)
    expect(rawImageBracketRunCloses('^[g]/')).toBe(true)
    expect(rawImageBracketRunCloses('^x[y')).toBe(false)
  })
})
