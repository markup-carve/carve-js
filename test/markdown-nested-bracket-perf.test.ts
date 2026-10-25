import { describe } from 'vitest'
import { carveToMarkdown } from '../src/index.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

describe('Markdown output over nested bracket runs', () => {
  perfIt('scales linearly when open brackets have no closer', () => {
    expectScansLinearly(source => void carveToMarkdown(source), '[', {
      label: 'unclosed bracket run',
      smallRepeats: 2_000,
      suffix: 'x\n',
    })
  })

  perfIt('scales linearly when nested brackets close as links', () => {
    expectScansLinearly(source => void carveToMarkdown(source + 'a' + '](x)'.repeat(source.length)), '[', {
      label: 'nested link-shaped bracket run',
      smallRepeats: 2_000,
    })
  })
})
