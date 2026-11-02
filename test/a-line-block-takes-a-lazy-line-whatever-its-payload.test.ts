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

for (const [marker, list, indent] of [['- a', 'ul', '  '], ['1. a', 'ol', '   ']]) {
  for (const [payload, body] of [
    ['```\nx', '<code>\nx\nafter</code>'],
    ['```', '<code>after</code>'],
    ['# h', '# h<br>after'],
    ['| a |', '| a |<br>after'],
    ['~~~', '~~~<br>after'],
  ]) {
    it(`keeps the lazy line in ${marker} after ${JSON.stringify(payload)}`, () => {
      const lines = payload.split('\n').map((line) => indent + line).join('\n')
      expect(normalize(carveToHtml(`${marker}\n\n${indent}::: |\n${lines}\nafter`))).toBe(
        normalize(`<${list}><li>a<div class="line-block"><p>${body}</p></div></li></${list}>`),
      )
    })
  }
}

// Expected payload HTML and container boundaries come from the layout checker.
const payloadCases = [
  ['```', '<code></code>', '<code>after</code>'],
  ['~~~', '~~~', '~~~<br>after'],
  ['# h', '# h', '# h<br>after'],
  ['| a |', '| a |', '| a |<br>after'],
  ['x', 'x', 'x<br>after'],
  ['%%%', '', '<br>after'],
  ['$$', '$$', '$$<br>after'],
  ['> q', '&gt; q', '&gt; q<br>after'],
  ['- z', '- z', '- z<br>after'],
] as const

for (const [name, host, indent] of [
  ['shifted item', '- a', '   '],
  ['nested item', '- a\n  - b', '    '],
  ['quoted item', '> - a', '>   '],
] as const) {
  for (const [payload, detachedBody, foldedBody] of payloadCases) {
    for (const blank of [false, true]) {
      it(`handles ${name} after ${JSON.stringify(payload)}, blank=${blank}`, () => {
        const source = `${host}\n${blank ? indent.trimEnd() + '\n' : ''}${indent}::: |\n${indent}${payload}\nafter\n`
        // A nested item's line block folds like a shallow one's (PART 0 S4, carve-js#3995);
        // a fence-shaped payload opens no fence there either (CARVE-P9-047, carve#4661).
        const detached = name === 'nested item' && payload === '%%%'
        const body = detached ? detachedBody : foldedBody
        const block = `<div class="line-block"><p>${body}</p></div>`
        // An unclosed `%%%` leaves no paragraph, so `after` ends the span and its hosts (carve#4907).
        const empty = '<div class="line-block"></div>'
        const html = payload === '%%%'
          ? name === 'nested item' ? `<ul><li>a<ul><li>b${empty}</li></ul></li></ul><p>after</p>`
            : name === 'quoted item' ? `<blockquote><ul><li>a${empty}</li></ul></blockquote><p>after</p>`
              : `<ul><li>a${empty}</li></ul><p>after</p>`
          : detached
          ? `<ul><li>a<ul><li>b${block}</li></ul></li></ul><p>after</p>`
          : name === 'nested item'
            ? `<ul><li>a<ul><li>b${block}</li></ul></li></ul>`
          : name === 'quoted item'
            ? `<blockquote><ul><li>a${block}</li></ul></blockquote>`
            : `<ul><li>a${block}</li></ul>`
        expect(normalize(carveToHtml(source))).toBe(normalize(html))
      })
    }
  }
}

// The unmarked marker closes the quote that holds an item (PART 0 S3, carve#4860).
it('ends the quoted line block at an unmarked list marker after a shifted fence run', () => {
  const source = '> - ::: |\n>   a\n>     :::\n>   b\n- tail\n'
  expect(normalize(carveToHtml(source))).toBe(
    '<blockquote><ul><li><div class="line-block"><p>a<br>&nbsp;&nbsp;:::<br>b</p></div></li></ul></blockquote><ul><li>tail</li></ul>',
  )
})

it('removes the lazy frame in a line block inside a quoted div', () => {
  const source = '> - b\n>\n>   :::\n>     ::: |\n>     ```\n>   :::\n>   para\n>   ```\nlazy\n'
  expect(normalize(carveToHtml(source))).toBe(normalize(
    '<blockquote><ul><li>b<div><div class="line-block"><p><code>\n:::\npara\n</code><br>lazy</p></div></div></li></ul></blockquote>',
  ))
})
