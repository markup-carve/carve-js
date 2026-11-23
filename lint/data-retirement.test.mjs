import { afterEach, expect, it } from 'vitest'
import { lint } from './lint.ts'

afterEach(() => { delete process.env.CARVE_LINT_RULES })

it('runs converted lint rows through data regardless of the former internal switch', () => {
  const source = '𝐀_a_\n\n![a](x)\n^ [!NOTE]\n'
  const options = { rules: { 'deprecated-bare-underline': 'on', 'djot-emphasis-underscore': 'on', 'github-alert-marker': 'on' }, platforms: ['github'] }
  const outputs = []
  for (const value of [undefined, 'data', 'code']) {
    if (value === undefined) delete process.env.CARVE_LINT_RULES
    else process.env.CARVE_LINT_RULES = value
    outputs.push(lint(source, options))
  }
  expect(outputs[1]).toEqual(outputs[0])
  expect(outputs[2]).toEqual(outputs[0])
  expect(outputs[0].filter((entry) => ['deprecated-bare-underline', 'djot-emphasis-underscore', 'github-alert-marker'].includes(entry.code))).toEqual([])
})

it('keeps data rule paths and tie order at their source nodes', () => {
  const heading = lint('# A {.c}\n').map((entry) => entry.code)
  expect(heading).toEqual(['heading-trailing-attribute', 'unattached-inline-attribute'])
  const item = lint('- a\n\n b').find((entry) => entry.code === 'list-item-body-below-content-column')
  expect(item?.path).toBe('/children/0/children/0')
  const comment = lint('> %%%%\n> %%%% x', { upgrade: true }).find((entry) => entry.code === 'comment-fence-closer-with-text')
  expect(comment?.path).toBe('/children/0/children/0')
})
