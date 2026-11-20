import { describe, expect, it } from 'vitest'
import { format, render } from '../public/index.ts'
import { imgFence } from '../public/extensions.ts'
import { lint } from '../lint/lint.ts'

const source = '- [ ] Another pending item\n\n  With additional content.\n'

describe('20 November rulings', () => {
  it('carve#6230: the task mark does not move the bullet content column', () => {
    for (const mark of [' ', 'x', 'X', '-', '>', '?']) {
      const input = source.replace('[ ]', `[${mark}]`)
      expect(lint(input).filter((d) => d.code === 'list-item-body-below-content-column')).toEqual([])
      expect(format(input)).toBe(mark === 'X' ? input.replace('[X]', '[x]') : input)
    }
    expect(lint('- a\n\n b\n').some((d) => d.code === 'list-item-body-below-content-column')).toBe(true)
  })

  it('carve#6238: only an authored alt supplies the imgFence image alt', () => {
    const body = '```img\n<svg><title>T</title><rect/></svg>\n```\n'
    expect(render(body, imgFence())).toContain('alt=""')
    expect(render(`{alt="A red box" #pic .c}\n${body}`, imgFence())).toContain('alt="A red box" id="pic" class="c"')
  })
})
