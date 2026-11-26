import { describe, expect, it } from 'vitest'
import { lint, render } from '../src/index.ts'

const MESSAGE = 'The %%% comment fence opened here has no closing fence and hides everything to the end of its container '
  + '(or: the document). Add a closing %%% where the comment should stop.'

// carve#6479: a comment block in a line block body that the body ends is unclosed (C2-B-111, C2-B-123).
describe('C2-B-111, C2-B-123: an unclosed comment block in a line block (carve#6479)', () => {
  it('reports the comment block of a closed line block, ranged over the comment', () => {
    const source = '::: |\na\n%%%\nc\n:::\n'
    expect(lint(source)).toEqual([{
      code: 'unclosed-comment-fence', severity: 'error', channel: 'parse', message: MESSAGE, path: '/children/0/children/1',
      range: { startOffset: 8, endOffset: 13 },
    }])
  })

  it('reports it next to the unclosed line block', () => {
    expect(lint('::: |\na\n%%%\nc\n').map((finding) => finding.code)).toEqual(['unclosed-container-fence', 'unclosed-comment-fence'])
  })

  it('reports nothing for a comment block that closes in the body', () => {
    expect(lint('::: |\na\n%%%\nc\n%%%\nd\n:::\n')).toEqual([])
  })

  it('leaves the HTML as it was', () => {
    expect(render('::: |\na\n%%%\nc\n:::\n')).toBe('<div class="line-block">\n  <p>a</p>\n</div>')
  })
})
