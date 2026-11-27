import { describe, expect, it } from 'vitest'
import { lint, prepareLint } from '../public/index.ts'
import { parse } from '../src/api.ts'
import { CarveOptionError } from '../src/options.ts'

describe('prepared lint handle', () => {
  it('exposes the resolved tree and keeps lint output identical', () => {
    const source = '= Alpha\n\nSee [a](#alpha) and [missing][].\n\n|= Name |= Value |\n| a | b |\n'
    const options = { headingIds: 'lower' as const, upgrade: true }
    const prepared = prepareLint(source, options)
    expect(prepared.document).toEqual(parse(source, { headingIds: 'lower' }))
    expect(lint(prepared)).toEqual(lint(source, options))
    expect(lint(prepared)).toEqual(lint(prepared))
  })

  it('rejects unprepared handles and options supplied after parsing', () => {
    expect(() => lint({ document: parse('text') })).toThrowError(CarveOptionError)
    expect(() => lint(prepareLint('text'), { upgrade: true })).toThrowError(CarveOptionError)
  })

  it('keeps included-file diagnostics', () => {
    const source = '{{ child.crv }}\n'
    const options = { includes: (request: { path: string }) => request.path === 'child.crv'
      ? { text: '[x]()\n', id: request.path } : { error: 'not_found' as const } }
    expect(lint(prepareLint(source, options))).toEqual(lint(source, options))
  })
})
