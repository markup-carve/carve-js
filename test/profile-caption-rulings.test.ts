import { expect, it } from 'vitest'
import { carveToHtml, Profile } from '../src/index.js'

it('uses visible cross-reference text when a profile denies the node', () => {
  expect(carveToHtml('</#a>', { profile: Profile.comment() })).toBe('<p>a</p>')
  expect(carveToHtml('{#a}\n# Title\n\n</#a>', {
    profile: Profile.full().denyInline(['heading_ref']),
  })).toContain('<p>Title</p>')
})

it('uses the literal code payload when a profile denies code blocks', () => {
  expect(carveToHtml('```\nx\n```', { profile: Profile.minimal() })).toBe('<p>x</p>')
})

it('starts a paragraph at the repeated caption marker after an unresolved image', () => {
  expect(carveToHtml('![a][r]\n^ cap\n^ next')).toBe('<p>![a][r]\n^ cap</p>\n<p>^ next</p>')
})
