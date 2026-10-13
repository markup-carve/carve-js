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
        const body = name === 'nested item' ? detachedBody : foldedBody
        const block = `<div class="line-block"><p>${body}</p></div>`
        const html = name === 'nested item'
          ? `<ul><li>a<ul><li>b${block}</li></ul></li></ul><p>after</p>`
          : name === 'quoted item'
            ? `<blockquote><ul><li>a${block}</li></ul></blockquote>`
            : `<ul><li>a${block}</li></ul>`
        expect(normalize(carveToHtml(source))).toBe(normalize(html))
      })
    }
  }
}

it('reads a quote-lazy list marker as line-block text after a shifted fence run', () => {
  const source = '> - ::: |\n>   a\n>     :::\n>   b\n- tail\n'
  expect(normalize(carveToHtml(source))).toBe(
    '<blockquote><ul><li><div class="line-block"><p>a<br>&nbsp;&nbsp;:::<br>b<br>- tail</p></div></li></ul></blockquote>',
  )
})

it('removes the lazy frame in a line block inside a quoted div', () => {
  const source = '> - b\n>\n>   :::\n>     ::: |\n>     ```\n>   :::\n>   para\n>   ```\nlazy\n'
  expect(normalize(carveToHtml(source))).toBe(normalize(
    '<blockquote><ul><li>b<div><div class="line-block"><p><code>\n:::\npara\n</code><br>lazy</p></div></div></li></ul></blockquote>',
  ))
})
