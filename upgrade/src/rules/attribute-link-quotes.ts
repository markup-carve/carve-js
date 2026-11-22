import { change, type Context, type Visit } from '../context.ts'
import { type Node01 } from '../engines.ts'
import { lineStart } from '../source.ts'

function paragraphOf(visit: Visit): Node01 | null {
  for (let up = visit.parent; up !== null; up = up.parent) {
    if (up.node.type === 'paragraph') return up.node
  }
  return null
}

function typeOldQuotes(ctx: Context): void {
  for (const visit of ctx.visits) {
    const node = visit.node
    if (node.type !== 'smart_punctuation' || node.pos === undefined || typeof node.glyph !== 'string') continue
    const at = node.pos.startOffset
    if (node.pos.endOffset !== at + 1 || ctx.src[at] !== '"' && ctx.src[at] !== "'") continue
    const paragraph = paragraphOf(visit)
    if (paragraph?.pos === undefined || !ctx.src.slice(paragraph.pos.startOffset, paragraph.pos.endOffset).includes('{')) continue
    ctx.findings = ctx.findings.filter(({ edit }) => edit === null || edit.start !== at || edit.end !== at + 1)
    change(ctx, 'U-190', at, at + 1, node.glyph, 'old smart quote typed explicitly beside an attribute-like atom')
  }
}

function escapeAttributeBeforeLink(ctx: Context): void {
  for (const visit of ctx.visits) {
    const node = visit.node
    if (node.type !== 'link' || node.pos === undefined || paragraphOf(visit) === null) continue
    const at = node.pos.startOffset
    if (ctx.src[at] !== '[') continue
    const start = lineStart(ctx.lines, node.pos.startLine)
    const brace = ctx.src.lastIndexOf('{', at - 1)
    if (brace < start || ctx.src[brace - 1] === '\\') continue
    if (!/^\{[^{}\n]+=["']$/u.test(ctx.src.slice(brace, at))) continue
    change(ctx, 'U-275', brace, brace, '\\', 'opening brace escaped so the old link pairs through the attribute-like text')
  }
}

/** U-190 and U-275 together keep inline forms that 0.1 read through attribute-like text. */
export function attributeLinkQuotes(ctx: Context): void {
  typeOldQuotes(ctx)
  escapeAttributeBeforeLink(ctx)
}
