// The clauses that the specification commits "decide the cases the three engine lanes logged" and
// "fix what the review of today's clauses found" added or changed, one test per clause id.
import { describe, expect, it } from 'vitest'
import { render, type RenderOptions } from '../src/index.ts'

/** [clause id and subject, source, expected HTML, options]. */
type Case = readonly [string, string, string, RenderOptions?]

function check(cases: readonly Case[]): void {
  for (const [name, src, html, options] of cases) {
    it(name, () => {
      expect(render(src, options)).toBe(html)
    })
  }
}

describe('the URL policy', () => {
  check([
    ['C2-H-159: the scheme test removes the bidirectional embeddings and overrides', '[x](java‮script:alert(1))', '<p><a href="">x</a></p>'],
    ['C2-H-159: the scheme test removes the bidirectional isolates', '[x](java⁦script:alert(1))', '<p><a href="">x</a></p>'],
    ['C2-H-161: an authored value is tested with the bidirectional controls removed', '[t]{title="java‮script:x"}', '<p><span title="">t</span></p>'],
    ['C2-H-167: an autolink is allowed under comment and takes the rel of the profile', '<https://a.b>',
      '<p><a href="https://a.b" rel="nofollow ugc">https://a.b</a></p>', { profile: 'comment' }],
  ])
})

describe('the rel of a link', () => {
  check([
    ['C2-H-167: an authored rel that C2-H-161 empties gives no word, and the profile words stay', '[x](/u){rel="javascript:foo"}',
      '<p><a href="/u" rel="nofollow ugc">x</a></p>', { profile: 'comment' }],
    ['C2-H-167: with no word from the author or the profile there is no rel', '[x](/u){rel="javascript:foo"}', '<p><a href="/u">x</a></p>'],
    ['C2-H-167: an empty authored rel gives no attribute', '[x](/u){rel=""}', '<p><a href="/u">x</a></p>'],
    ['C2-H-167: rel stands behind href and before the id and the classes', '[x](/u){#i .c rel=me}', '<p><a href="/u" rel="me" id="i" class="c">x</a></p>'],
    ['C2-H-167: the authored words come first, then the profile words not among them', '[x](/u){rel="ugc me"}',
      '<p><a href="/u" rel="ugc me nofollow">x</a></p>', { profile: 'comment' }],
  ])
})
