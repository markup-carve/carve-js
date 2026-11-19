// The quote attribution reading of the 0.1 BBCode importer (carve#3341): a `name (date) #id` caption, and the fields
// it leaves out. The rules are those of 0.1; the code is split into steps.

/** A field the caption leaves out: a named field, or text beside a `name=` field. */
export interface DroppedField { field: string, unnamed: boolean }

type Field = { kind: 'field', key: string, value: string, index: number }
type Text = { kind: 'text', text: string, quoted: boolean, index: number }
type Part = Field | Text
type Known = 'name' | 'post_id' | 'id' | 'date' | 'time'

const ASCII_DIGITS = /^[0-9]+$/u
const KEY = /^[A-Za-z_][A-Za-z0-9_-]*=/u

/** ASCII whitespace only, so every engine splits an attribution at the same places. */
function isSpace(char: string | undefined): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f'
}

function runEnd(text: string, from: number): number {
  let at = from
  while (at < text.length && !isSpace(text[at])) at++
  return at
}

function quotedEnd(text: string, from: number): number {
  const quote = text[from]
  return quote === '"' || quote === "'" ? text.indexOf(quote, from + 1) : -1
}

/** One part at `at`: a `key=value` field, a quoted text or a bare word, and where the next one starts. */
function partAt(text: string, at: number, index: number): { part: Part, next: number } {
  const key = KEY.exec(text.slice(at))
  if (key) {
    const from = at + key[0].length
    const close = quotedEnd(text, from)
    const to = close === -1 ? runEnd(text, from) : close
    const value = close === -1 ? text.slice(from, to) : text.slice(from + 1, to)
    return { part: { kind: 'field', key: key[0].slice(0, -1), value, index }, next: close === -1 ? to : close + 1 }
  }
  const close = quotedEnd(text, at)
  if (close !== -1) return { part: { kind: 'text', text: text.slice(at + 1, close), quoted: true, index }, next: close + 1 }
  const to = runEnd(text, at)
  return { part: { kind: 'text', text: text.slice(at, to), quoted: false, index }, next: to }
}

function partsOf(text: string): Part[] {
  const parts: Part[] = []
  for (let at = 0; at < text.length;) {
    if (isSpace(text[at])) { at++; continue }
    const { part, next } = partAt(text, at, parts.length)
    parts.push(part)
    at = next
  }
  return parts
}

interface Reading { first: Partial<Record<Known, Field>>, texts: Text[], drops: (DroppedField & { index: number })[] }

function knownKey(key: string): Known | undefined {
  const kind = key.toLowerCase() === 'author' ? 'name' : key.toLowerCase()
  return ['name', 'post_id', 'id', 'date', 'time'].includes(kind) ? kind as Known : undefined
}

function collect(parts: Part[]): Reading {
  const reading: Reading = { first: {}, texts: [], drops: [] }
  for (const part of parts) {
    if (part.kind === 'text') {
      if (part.text !== '') reading.texts.push(part)
      continue
    }
    const kind = knownKey(part.key)
    const usable = part.value !== '' && (kind !== 'post_id' && kind !== 'id' || ASCII_DIGITS.test(part.value))
    if (kind === undefined || !usable || reading.first[kind] !== undefined) drop(reading, part)
    else reading.first[kind] = part
  }
  return reading
}

function drop(reading: Reading, part: Field): void {
  reading.drops.push({ field: part.key, unnamed: false, index: part.index })
}

/** `post_id` outranks `id`, which outranks a leading quoted number; a leading number a field outranks is dropped as `id`. */
function idOf(reading: Reading): string | undefined {
  const lead = reading.texts[0]
  const leadingId = lead?.quoted === true && lead.index === 0 && ASCII_DIGITS.test(lead.text) ? reading.texts.shift() : undefined
  const { post_id: postId, id } = reading.first
  if (leadingId && (postId || id)) reading.drops.push({ field: 'id', unnamed: false, index: leadingId.index })
  if (postId) {
    if (id) drop(reading, id)
    return postId.value
  }
  return id?.value ?? leadingId?.text
}

/** With a `name=` field, the other texts are dropped; adjacent bare words count as one. */
function dropUnnamed(reading: Reading, vbulletinId: string | undefined): void {
  const drops: { field: string, index: number }[] = []
  let previous: Text | undefined
  for (const part of reading.texts) {
    const last = drops.at(-1)
    if (!part.quoted && previous && !previous.quoted && previous.index + 1 === part.index && last) last.field += ` ${part.text}`
    else drops.push({ field: part.text, index: part.index })
    previous = part
  }
  const last = drops.at(-1)
  if (vbulletinId !== undefined && last) last.field = last.field.slice(0, -vbulletinId.length - 1)
  for (const part of drops) if (part.field !== '') reading.drops.push({ ...part, unnamed: true })
}

/** A Unix `time` gives the date and outranks `date`; any other `time` follows the date. */
function dateOf(reading: Reading): string | undefined {
  const { date, time } = reading.first
  if (!time) return date?.value
  if (!/^[0-9]{9,11}$/u.test(time.value)) return date ? `${date.value} ${time.value}` : time.value
  if (date) drop(reading, date)
  return new Date(Number(time.value) * 1000).toISOString().slice(0, 10)
}

/** Reads a quote attribution into its `name (date) #id` caption and the parts it drops, in source order. */
export function readAttribution(attribution: string): { caption: string, dropped: DroppedField[] } {
  const reading = collect(partsOf(attribution))
  let id = idOf(reading)
  let text = reading.texts.map(part => part.text).join(' ')
  const vbulletin = id === undefined ? /^([\s\S]+);([0-9]+)$/u.exec(text) : null
  if (vbulletin?.[1] !== undefined && vbulletin[2] !== undefined) {
    text = vbulletin[1]
    id = vbulletin[2]
  }
  const name = reading.first.name?.value ?? text
  if (reading.first.name) dropUnnamed(reading, vbulletin?.[2])
  const date = dateOf(reading)
  const caption = [name, date !== undefined ? `(${date})` : '', id !== undefined ? `#${id}` : ''].filter(part => part !== '').join(' ')
  reading.drops.sort((a, b) => a.index - b.index)
  return { caption, dropped: reading.drops.map(({ field, unnamed }) => ({ field, unnamed })) }
}
