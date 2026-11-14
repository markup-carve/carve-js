// Every block entry that holds inline text, with every inline entry in that text: 31 times 10
// inputs. Both entries are reported, no edit gives way, and the self-check passes.
import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

const BLOCKS: [string, string][] = [
  ['U-001', 'Some text\n# TEXT\n'],
  ['U-002', 'Some text\n> TEXT\n'],
  ['U-004', 'Some text\n:: TEXT\n: d\n'],
  ['U-006', '- item\n# TEXT\n'],
  ['U-009', '- text\n  :: TEXT\n  : desc\n'],
  ['U-010', '| a | b |\n^ TEXT\n# H\n'],
  ['U-014', '- one\n+\n> TEXT\n- two\n'],
  ['U-015', '- a\n+\nTEXT\n- b\n'],
  ['U-016', '> quoted\n+\n- TEXT\n'],
  ['U-017', '- +\n  TEXT\n- two\n'],
  ['U-018', '- TEXT\n\n  second\n- b\n'],
  ['U-020', '{loose}\n- TEXT\n- b\n'],
  ['U-022', ' 9. TEXT\n10. b\n'],
  ['U-023', '- a\n - TEXT\n'],
  ['U-024', 'i) TEXT\nj) two\n'],
  ['U-025', '1234567890. TEXT\n'],
  ['U-031', '{.note}\n\nTEXT\n'],
  ['U-033', '- a\n{.x}\n- TEXT\n'],
  ['U-038', '- item[^n]\n\n  [^n]: TEXT\n'],
  ['U-039', 'Text[^a].\n\n [^a]: TEXT\n'],
  ['U-055', '| TEXT | b |\n|---|--:|\n| 1 | 2 |\n'],
  ['U-056', '|=< TEXT |=> b |\n| 1 | 2 |\n'],
  ['U-057', '| TEXT | b \\|\n'],
  ['U-058', '{header-rows=1}\n| TEXT | b |\n| 1 | 2 |\n'],
  ['U-063', '| a | b |\n\n^ TEXT\n'],
  ['U-101', '= TEXT\n'],
  ['U-102', '# Heading\n  TEXT\n'],
  ['U-103', 'a. TEXT\nb. two\n'],
  ['U-106', ':: term\nTEXT\n: first\n'],
  ['U-107', '| a | b |\n^ first\n^ TEXT\n'],
  ['U-109', '- item\n\n TEXT\n'],
]

const INLINES: [string, string][] = [
  ['U-065', 'an _u_ word'],
  ['U-066', 'a ~s~ word'],
  ['U-067', 'a =m= word'],
  ['U-068', '/*bi*/ word'],
  ['U-069', '{~old~>new~} word'],
  ['U-070', '*b {/n*/} m*'],
  ['U-071', "said 'Bob left"],
  ['U-112', 'See [x][^zz] here'],
  ['U-113', 'See [*b*][nope] here'],
  ['U-115', 'run --flag here'],
]

/**
 * A reference with a caret label in a heading: 0.1 makes the heading id from the text of the
 * reference alone (`See-x-here`), 0.2 from the whole text (`See-x-zz-here`). No entry of the
 * contract covers a heading id, so the self-check reports it.
 */
const HEADING_ID = new Set(['U-001 U-112', 'U-006 U-112'])

describe('every block entry with every inline entry', () => {
  for (const [block, template] of BLOCKS) {
    for (const [inline, text] of INLINES) {
      const name = `${block} ${inline}`
      it(name, () => {
        const result = upgrade(template.replace('TEXT', text))
        const hit = result.records.map((record) => record.entry)
        expect(hit).toContain(block)
        expect(hit).toContain(inline)
        expect(hit).not.toContain('upgrade-conflict')
        expect(result.check).toBe(HEADING_ID.has(name) ? 'mismatch' : 'pass')
      })
    }
  }
})
