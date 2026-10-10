import { describe, expect, it } from 'vitest'
import { carveToCarve, fromAstJson, parse, renderCarve, SourceUnspellableError, toAstJson } from '../src/index.js'

// An editorial comment's content is literal (PART 3) and takes any character
// but its own closer (`edCommentBody = "{#" (~"#}" edChar)+ "#}"`), so the
// writer adds no escape to it and only a text holding `#}` is unspellable.
// carve-js#1847 read this engine's old `[^}]` matcher as the rule instead and
// refused one brace too many; carve#2877's parser follows the grammar.

const commentText = (source: string): unknown =>
  (toAstJson(parse(source)).children[0] as unknown as { children: Array<{ text?: string }> }).children[0]!.text

describe('the Carve writer on an editorial comment', () => {
  it.each(['{#{-#}', '{#a\\b#}', '{# x #}', '{#a#b#}', '{#a}b#}'])('writes %s back unchanged', (source) => {
    expect(carveToCarve(`${source}\n`)).toBe(`${source}\n`)
    expect(commentText(carveToCarve(`${source}\n`))).toBe(commentText(source))
  })

  it('keeps a comment whose text holds a bare closing brace', () => {
    expect(carveToCarve('{#a}b#}\n')).toBe('{#a}b#}\n')
    expect(commentText('{#a}b#}')).toBe('a}b')
  })

  it('refuses a comment whose text holds its own closing sequence', () => {
    const document = fromAstJson({
      type: 'document',
      srcByteLength: 0,
      children: [{ type: 'paragraph', children: [{ type: 'critic_comment', text: 'a#}b' }] }],
    } as never)
    let thrown: unknown
    try {
      renderCarve(document)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(SourceUnspellableError)
    expect((thrown as SourceUnspellableError).nodeType).toBe('critic_comment')
  })

  it('stops at the first closing sequence in the source too', () => {
    expect(commentText('{#a#}b#}')).toBe('a')
  })
})
