import transformations from '../data/html-transformations.json' with { type: 'json' }
import { compareHtml, htmlTokens } from './compare.ts'

interface Result { html: string; applied: string[] }

/** C2-H-032: add only the generated task class and list style to an existing task item tag. */
export function addTaskPresentation(old: string, next: string): Result {
  const source = htmlTokens(old)
  const target = htmlTokens(next)
  let changed = false
  for (let at = 0; at < Math.min(source.length, target.length); at++) {
    const before = source[at]
    const after = target[at]
    if (before === undefined || after === undefined || !before.startsWith('<li') || !after.startsWith('<li')) continue
    if (before === after || !after.includes('task') || !compareHtml(before, after).equal) continue
    source[at] = after
    changed = true
  }
  return { html: source.join(''), applied: changed ? ['U-133'] : [] }
}

function isLiOpen(token: string): boolean { return token === '<li>' || token.startsWith('<li ') }

function noteContent(token: string, seen: boolean[]): void {
  if (isLiOpen(token)) { if (seen.length > 0) seen[seen.length - 1] = true; seen.push(false); return }
  if (token === '</li>') { seen.pop(); return }
  if (seen.length > 0 && token.trim() !== '' && !token.startsWith('</')) seen[seen.length - 1] = true
}

function canWrap(current: string, target: readonly string[], at: number, seen: readonly boolean[]): boolean {
  return target[at] === '<p>' && target[at + 1] === current && seen[seen.length - 1] === true
}

/** C2-H-036: only later list-item paragraphs gain wrappers under U-019. */
export function wrapLaterItemParagraphs(old: string, next: string): Result {
  const source = htmlTokens(old)
  const target = htmlTokens(next)
  const result: string[] = []
  const seen: boolean[] = []
  let changed = false
  let paragraphOpen = false
  let at = 0
  let to = 0
  while (at < source.length && to < target.length) {
    const current = source[at]
    if (paragraphOpen && target[to] === '</p>') {
      result.push('</p>')
      paragraphOpen = false
      to++
      continue
    }
    if (current !== undefined && current === target[to]) {
      result.push(current)
      noteContent(current, seen)
      at++
      to++
      continue
    }
    if (seen.length === 0 || current === undefined) break
    if (canWrap(current, target, to, seen)) {
      result.push('<p>', current)
      paragraphOpen = true
      changed = true
      at++
      to += 2
      continue
    }
    if (!wrapSplitText(current, target, to, result)) break
    seen[seen.length - 1] = true
    paragraphOpen = true
    changed = true
    at++
    to += 3
  }
  result.push(...source.slice(at))
  return { html: result.join(''), applied: changed ? ['U-019'] : [] }
}

function wrapSplitText(current: string, target: readonly string[], to: number, result: string[]): boolean {
  let newline = current.indexOf('\n')
  while (newline >= 0) {
    const first = current.slice(0, newline)
    const later = current.slice(newline + 1)
    if (first === target[to] && target[to + 1] === '<p>' && later === target[to + 2]) {
      result.push(first, '<p>', later)
      return true
    }
    newline = current.indexOf('\n', newline + 1)
  }
  return false
}

function at(tokens: readonly string[], before: readonly string[], left: string | null, right: string | null, start: number): boolean {
  if (start + before.length > tokens.length) return false
  if (left !== null && tokens[start - 1] !== left) return false
  if (right !== null && tokens[start + before.length] !== right) return false
  return before.every((value, offset) => tokens[start + offset] === value)
}

/** C2-H-088: the note reference follows the containing link. */
function noteNumber(token: string, owner: string | undefined): string | null {
  if (owner !== 'a' || !token.startsWith('<sup id="fnref') || !token.endsWith('">')) return null
  const number = token.slice('<sup id="fnref'.length, -2)
  return number.length > 0 && [...number].every((character) => character >= '0' && character <= '9') ? number : null
}

function trackOpen(token: string, open: string[]): void {
  if (token.startsWith('</')) { open.pop(); return }
  if (!token.startsWith('<') || token.startsWith('<!') || token.endsWith('/>')
    || token.startsWith('<input') || token.startsWith('<hr') || token.startsWith('<br')) return
  const end = token.indexOf(' ') >= 0 ? token.indexOf(' ') : token.indexOf('>')
  open.push(token.slice(1, end))
}

function moveNoteReference(tokens: string[]): boolean {
  const open: string[] = []
  let changed = false
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (token === undefined) continue
    const number = noteNumber(token, open[open.length - 1])
    if (number !== null) {
      tokens[index] = `</a><a href="#fn${number}" id="fnref${number}" role="doc-noteref"><sup>`
      changed = true
    }
    trackOpen(token, open)
  }
  return changed
}

function targetMatches(change: { after: string[]; right: string | null }, target: readonly string[], index: number): boolean {
  if (change.after.length > 0) return at(target, change.after, null, null, index)
  return change.right === null ? index === target.length : target[index] === change.right
}

export function applyHtmlTransformations(old: string, next: string, entries: readonly string[]): Result {
  const tokens = htmlTokens(old)
  const target = htmlTokens(next)
  const applied: string[] = []
  const cited = new Set(entries)
  if (cited.has('U-154') && moveNoteReference(tokens)) applied.push('U-154')
  for (const change of transformations) {
    if (!cited.has(change.id)) continue
    for (let index = 0; index <= tokens.length - change.before.length;) {
      if (!at(tokens, change.before, change.left, change.right, index)
        || !targetMatches(change, target, index)) { index++; continue }
      tokens.splice(index, change.before.length, ...change.after)
      applied.push(change.id)
      index += change.after.length
    }
  }
  return { html: tokens.join(''), applied }
}
