import { describe, expect, it } from 'vitest'
import { carveToCarve, fromAstJson, parse, renderCarve, SourceUnspellableError, toAstJson } from '../src/index.js'

// An editorial comment's content is literal (PART 3), so the writer adds no
// escape to it; a `}` in the text has no spelling at all (carve-js#1847).

const commentText = (source: string): unknown =>
  (toAstJson(parse(source)).children[0] as unknown as { children: Array<{ text?: string }> }).children[0]!.text

describe('the Carve writer on an editorial comment', () => {
  it.each(['{#{-#}', '{#a\\b#}', '{# x #}', '{#a#b#}'])('writes %s back unchanged', (source) => {
    expect(carveToCarve(`${source}\n`)).toBe(`${source}\n`)
    expect(commentText(carveToCarve(`${source}\n`))).toBe(commentText(source))
  })

  it('refuses a comment whose text holds a closing brace', () => {
    const document = fromAstJson({
      type: 'document',
      srcByteLength: 0,
      children: [{ type: 'paragraph', children: [{ type: 'critic_comment', text: 'a}b' }] }],
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

  it('is not a comment in the source either, where the text would hold one', () => {
    expect(commentText('{#a}b#}')).toBeUndefined()
  })
})
