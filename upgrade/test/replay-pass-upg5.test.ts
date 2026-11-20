// Third replay pass: the example sources the readiness bar counted, and pack shapes of the same causes.
import { describe, expect, it } from 'vitest'
import map from '../../data/upgrade-map.json' with { type: 'json' }
import { canWriteUpgrade, upgrade } from '../src/index.ts'

const written: [string, string, string, string][] = [
  ['C2-B-046 U-434', '-   [ ] item\n    # H\n',
    '- [ ] item\n\n    # H\n', 'U-434'],
  ['C2-H-032 U-133', '- [ ] item\n  # H\n',
    '- [ ] item\n\n  # H\n', 'U-133'],
  ['C2-B-076 U-435', '- intro\n\n  :: term\n  :  definition\n   > quote\n',
    '- intro\n\n  :: term\n  :  definition\n\n  > quote\n', 'U-435'],
  ['C2-B-076 U-435', '[^n]: intro\n\n   :: term\n   :  definition\n    > quote\n\nsee[^n]\n',
    '[^n]: intro\n\n   :: term\n   :  definition\n\n   > quote\n\nsee[^n]\n', 'U-435'],
  ['C2-B-067 U-435', '- x\n\n  :: t\n  :  d\n     :: u\n     : v\n    : e\n',
    '- x\n\n  :: t\n  :  d\n\n     :: u\n     : v\n  : e\n', 'U-435'],
  ['C2-B-012 U-436', '- +\n  %% c\nafter\n',
    '- %% c\n  after\n', 'U-436'],
  ['C2-B-024 U-437', '> quoted\n+\n- item\n> more\n',
    '> quoted\n>\n> - item\n>\n> more\n', 'U-437'],
  ['C2-I-024 U-432', '/x /*a %% `b*/ c` d\n',
    '/x \\/*a{% \\`b%}*/ c` d`\n', 'U-432'],
  ['C2-I-024 U-432', '/*a %% `*/` b*/ c\n',
    '*/a{% \\`%}/*` b*/ c`\n', 'U-432'],
  ['C2-I-024 U-432', '{~a~>b %% `~}` c~} d\n',
    '{-a-}{+b{% \\`%}+}` c~} d`\n', 'U-432'],
  ['C2-B-213 U-058', '{header-rows=1}\n|{>} Wide|<|{~} Last|\n|a|b|c|\n',
    '|={style=\"text-align: right;\"} Wide|= <|={style=\"text-align: center;\"} Last|\n|a|b|c|\n', 'U-058'],
  ['C2-B-085 U-042', '> - a\n>   - para\n>     [^f]: n\n>     [^f]: n\ntail\n',
    '> - a\n>   - para\n\n[^f]: n\n\n', 'U-042'],
  ['C2-B-081 U-038', ' - para\n>   [^f]: n\ntail\n',
    ' - para\n\n>   {%%}\n\n[^f]: n\ntail\n', 'U-038'],
  ['C2-B-157 U-004', '![two](b.png)\n:: c\n::: nte\nbody\n\n:::\n',
    '![two](b.png)\n\n:: c\n::: nte\nbody\n\n:::\n', 'U-004'],
]

// Shapes no 0.2 spelling keeps: the report row is cited on the line of the difference, with no rewrite there.
const reported: [string, string, string][] = [
  ['C2-B-146 U-279', '> q\n\n^   cap\n\n![a](i.png)\n^ \tsecond\n', 'U-279'],
  ['C2-B-174 U-060', '{header-rows=1}\n| H | G |\n| ^ | b |\n', 'U-060'],
  ['C2-B-171 U-140', '> |\ta |```\tb |\n> |\ta |```\tb |\n', 'U-140'],
]

describe('the third replay pass', () => {
  it.each(written)('%s writes %j as %j', (_clause, source, output, id) => {
    const result = upgrade(source)
    expect(result.output).toBe(output)
    expect(canWriteUpgrade(result)).toBe(true)
    expect(result.records.some((record) => record.entry === id)).toBe(true)
  })

  it.each(reported)('%s reports %j', (_clause, source, id) => {
    const result = upgrade(source)
    expect(canWriteUpgrade(result)).toBe(false)
    const line = result.records.find((record) => record.class === 'mismatch')!.line
    const onLine = result.records.filter((record) => record.line === line && record.entry.startsWith('U-'))
    expect(onLine.map((record) => record.entry)).toContain(id)
    expect(onLine.some((record) => record.class === 'rewrite' || record.class === 'escape')).toBe(false)
  })

  // C2-H-032 gives every 0.2 task item the generated class and style, so U-434 is explained by U-133, and the
  // first U-435 example sat in a one-item list (U-021); markup-carve/carve#6209 gave it an example that passes.
  it.each(['U-434', 'U-435'])('%s writes the spelling of its map row', (id) => {
    const row = map.source.find((item) => item.id === id)!
    const result = upgrade(row.from)
    expect(result.output).toBe(row.to)
    expect(canWriteUpgrade(result)).toBe(true)
    expect(result.records.some((record) => record.entry === id)).toBe(true)
  })

  it('C2-B-046 U-434 leaves a box after an ordered marker to U-120', () => {
    expect(upgrade('1.   [ ] a\n').records.some((record) => record.entry === 'U-434')).toBe(false)
  })
})
