import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const normalize = (html: string) => html.replace(/\s+/g, ' ').replace(/ ?(<[^>]+>) ?/g, '$1').trim()

for (const [payload, body] of [
  ['```\n> x', '<code>\nx\nafter</code>'],
  ['# h\n> x', '# h<br>x<br>after'],
  ['```', '<code>after</code>'],
  ['# h', '# h<br>after'],
  ['| a |', '| a |<br>after'],
]) {
  it(`keeps the lazy line after ${JSON.stringify(payload)}`, () => {
    expect(normalize(carveToHtml(`> ::: |\n> ${payload}\nafter`))).toBe(
      normalize(`<blockquote><div class="line-block"><p>${body}</p></div></blockquote>`),
    )
  })
}

it('reads an unquoted fence run as inline line-block payload', () => {
  expect(normalize(carveToHtml('::: |\n```\nx\nafter'))).toBe(
    normalize('<div class="line-block"><p><code>\nx\nafter</code></p></div>'),
  )
})

it('leaves the quote after a closed line block', () => {
  expect(normalize(carveToHtml('> ::: |\n> x\n> :::\nafter'))).toBe(
    '<blockquote><div class="line-block"><p>x</p></div></blockquote><p>after</p>',
  )
})
