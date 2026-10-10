import { describe } from 'vitest'
import { parse } from '../src/index.js'
import { perfIt, timeCalls } from './helpers/scaling.js'

describe('TEMPORARY per-size probe for carve-js#2691', () => {
  perfIt('reports us/byte across sizes for the lazy quote chain', () => {
    for (const depth of [500, 1000, 2000, 4000, 8000, 16000, 32000]) {
      const src = '> '.repeat(depth) + 'x\ny'
      const { msPerCall } = timeCalls(() => void parse(src), 200)
      // eslint-disable-next-line no-console
      console.log(`PROBE depth=${depth} bytes=${src.length} usPerByte=${((msPerCall / src.length) * 1000).toFixed(4)}`)
    }
  })
})
