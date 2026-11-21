import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-H-095 and C2-H-096 cross-reference display', () => {
  for (const source of [
    '# *Setup*\n\nSee </#Setup>.\n',
    '# A </#A>\n',
    '# A </#B>\n\n# B </#A>\n',
    '{#t}\n| b |\n^ #y#\n\n</#t>\n',
  ]) {
    it(`U-206 names the display change in ${source.trim()}`, () => {
      const result = upgrade(source)
      const selfReference = source === '# A </#A>\n'
      expect(result.check).toBe(selfReference ? 'pass' : source.startsWith('# A </#B>') ? 'mismatch' : 'explained')
      expect(result.records.map((record) => record.entry)).toContain(selfReference ? 'U-366' : 'U-206')
      if (source.startsWith('# A </#B>')) expect(result.records.map((record) => record.entry)).toContain('upgrade-mismatch')
    })
  }
})
