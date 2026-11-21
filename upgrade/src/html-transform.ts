import transformations from '../data/html-transformations.json' with { type: 'json' }
import { compareHtml, htmlTokens } from './compare.ts'

interface Result { html: string; applied: string[] }

export function hasTaskClass(token: string): boolean {
  const start = token.indexOf(' class="')
  if (start < 0) return false
  const end = token.indexOf('"', start + 8)
  return end > start && token.slice(start + 8, end).split(' ').includes('task')
}

function taskStyle(token: string): boolean {
  return token.includes(' style="list-style: none"') || token.includes(' style="list-style: none; ')
}

function taskPresentationChange(before: string, after: string): boolean {
  return isLiOpen(before) && isLiOpen(after) && before !== after && hasTaskClass(after) && taskStyle(after)
    && !(hasTaskClass(before) && taskStyle(before)) && compareHtml(before, after).equal
}

export function hasTaskPresentationDifference(old: string, next: string): boolean {
  const before = htmlTokens(old).filter(isLiOpen)
  const after = htmlTokens(next).filter(isLiOpen)
  for (let index = 0; index < Math.min(before.length, after.length); index++) {
    const left = before[index]
    const right = after[index]
    if (left !== undefined && right !== undefined && taskPresentationChange(left, right)) return true
  }
  return false
}

/** C2-H-032: add only the generated task class and list style to an existing task item tag. */
export function addTaskPresentation(old: string, next: string): Result {
  const source = htmlTokens(old)
  const target = htmlTokens(next)
  let changed = false
  for (let at = 0; at < Math.min(source.length, target.length); at++) {
    const before = source[at]
    const after = target[at]
    if (before === undefined || after === undefined || !before.startsWith('<li') || !after.startsWith('<li')) continue
    if (!taskPresentationChange(before, after)) continue
    source[at] = after
    changed = true
  }
  return { html: source.join(''), applied: changed ? ['U-133'] : [] }
}

const LABEL = / aria-label="([^"]*)"/u

/** C2-H-032: the 0.2 box label also takes the text of the item's later paragraph and heading children. */
export function followTaskLabels(old: string, next: string): Result {
  const source = htmlTokens(old)
  const target = htmlTokens(next)
  let changed = false
  for (let at = 0; at < Math.min(source.length, target.length); at++) {
    const before = source[at]!
    const after = target[at]!
    if (!before.startsWith('<input ') || !before.includes('type="checkbox"')) continue
    const left = LABEL.exec(before)?.[1]
    const right = LABEL.exec(after)?.[1]
    if (left === undefined || right === undefined || !right.startsWith(`${left} `)) continue
    if (before.replace(LABEL, '') !== after.replace(LABEL, '')) continue
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

export function addShortTableColumns(old: string, next: string): Result {
  const source = htmlTokens(old)
  const target = htmlTokens(next)
  let targetAt = 0
  let changed = false
  for (let at = 0; at < source.length; at++) {
    if (source[at] !== '<colgroup>') continue
    targetAt = target.indexOf('<colgroup>', targetAt)
    if (targetAt < 0) break
    const end = source.indexOf('</colgroup>', at + 1)
    const targetEnd = target.indexOf('</colgroup>', targetAt + 1)
    if (end < 0 || targetEnd < 0) break
    const before = source.slice(at + 1, end)
    const after = target.slice(targetAt + 1, targetEnd)
    const added = after.slice(before.length)
    if (added.length > 0 && before.every((token, index) => token === after[index])
      && added.every((token) => token === '<col>' || token.startsWith('<col '))) {
      source.splice(end, 0, ...added)
      at = end + added.length
      changed = true
    }
    targetAt = targetEnd + 1
  }
  return { html: source.join(''), applied: changed ? ['U-150'] : [] }
}

export function dropEmptyClasses(old: string, next: string): Result {
  const source = htmlTokens(old)
  const target = htmlTokens(next)
  let changed = false
  for (let at = 0; at < source.length; at++) {
    const before = source[at] ?? ''
    const without = before.replace(/ class="[ \t]*"/u, '')
    if (without === before || without !== target[at]) continue
    source[at] = without
    changed = true
  }
  return { html: source.join(''), applied: changed ? ['U-282'] : [] }
}

export function moveTrailingSigilHyphen(old: string, next: string): Result {
  const source = htmlTokens(old)
  const target = htmlTokens(next)
  for (let at = 1; at + 3 < source.length; at++) {
    const before = source[at]
    if (source[at - 1] !== '<strong>' || before === undefined || !before.endsWith('-')
      || source[at + 1] !== '</strong>' || source[at + 2] !== '</span>'
      || before.slice(0, -1) !== target[at]) continue
    const after = source[at + 3]
    const written = target[at + 3]
    if (written === '-' && after?.startsWith('</')) {
      source[at] = before.slice(0, -1)
      source.splice(at + 3, 0, '-')
      return { html: source.join(''), applied: ['U-170'] }
    }
    if (after !== undefined && written === `-${after}`) {
      source[at] = before.slice(0, -1)
      source[at + 3] = written
      return { html: source.join(''), applied: ['U-170'] }
    }
  }
  return { html: old, applied: [] }
}

function emptyRunMarkup(literal: string): string[] | null {
  if (/^\$\$`+$/u.test(literal)) return ['<span class="math display" role="math">', '\\[\\]', '</span>']
  if (/^\$`+$/u.test(literal)) return ['<span class="math inline" role="math">', '\\(\\)', '</span>']
  if (/^`+$/u.test(literal)) return ['<code>', '</code>']
  return null
}

/** U-258: the parsed empty run has no adjacent closer spelling, so cite its literal 0.2 reading. */
export function explainEmptyRuns(old: string, literals: readonly string[], next = ''): Result {
  const tokens = htmlTokens(old)
  const target = new Set(htmlTokens(next))
  let changed = false
  for (const literal of literals) {
    const before = emptyRunMarkup(literal)
    if (before === null) continue
    for (let at = 0; at <= tokens.length - before.length; at++) {
      if (!before.every((token, offset) => tokens[at + offset] === token)) continue
      // The tokens drop the soft break before the run; 0.2 keeps it in the text of the run.
      const text = tokens[at - 1]
      if (at > 0 && text !== undefined && !text.startsWith('<') && target.has(`${text}\n${literal}`)
        && !target.has(text + literal)) {
        tokens.splice(at - 1, before.length + 1, `${text}\n${literal}`)
        changed = true
        break
      }
      tokens.splice(at, before.length, literal)
      changed = true
      break
    }
  }
  return { html: changed ? tokens.join('') : old, applied: changed ? ['U-258'] : [] }
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
