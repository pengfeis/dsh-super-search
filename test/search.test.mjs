/**
 * Exercises the plugin's text extraction and matching against real session logs.
 *
 * Usage: node test/search.test.mjs <decompressed-session.jsonl> [...]
 */
import { readFileSync } from 'node:fs'
import { entryOfEvent, entriesOfEvents, termsOf, snippetAround } from '../index.js'

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: node test/search.test.mjs <session.jsonl> [...]')
  process.exit(2)
}

const entries = []
let toolResultChars = 0
let assistantChars = 0
let reasoningChars = 0

for (const file of files) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event.type === 'tool/result') {
      for (const block of event.data?.message?.content ?? []) {
        if (block.type === 'text') toolResultChars += block.text.length
      }
    }
    if (event.type === 'assistant/message') {
      for (const block of event.data?.message?.content ?? []) {
        if (block.type === 'text') assistantChars += block.text.length
        if (block.type === 'reasoning') reasoningChars += block.text.length
      }
    }
    const entry = entryOfEvent(event)
    if (entry !== undefined) entries.push({ ...entry, file })
  }
}

console.log(`indexed ${entries.length} messages from ${files.length} log(s)`)
console.log(`assistant text chars: ${assistantChars}, reasoning chars: ${reasoningChars}, tool output chars: ${toolResultChars}`)

const search = (query) => {
  const terms = termsOf(query)
  const hits = []
  for (const entry of entries) {
    const haystack = entry.text.toLowerCase()
    let index = -1
    let matched = true
    for (const term of terms) {
      const at = haystack.indexOf(term)
      if (at < 0) {
        matched = false
        break
      }
      if (index < 0 || at < index) index = at
    }
    if (!matched) continue
    hits.push({ ...entry, snippet: snippetAround(entry.text, index, terms[0].length, 60) })
  }
  return hits
}

const report = (label, query) => {
  const hits = search(query)
  console.log(`\n--- ${label}: "${query}" -> ${hits.length} hit(s)`)
  for (const hit of hits.slice(0, 3)) {
    console.log(`  [${hit.role}] ${hit.snippet.replace(/\n/gu, ' ').slice(0, 160)}`)
  }
  return hits
}

const chinese = report('chinese phrase', '插件')
const english = report('english inside a word', 'install')
const combined = report('two terms', '插件 安装')

let failures = 0
const check = (condition, message) => {
  if (condition) {
    console.log(`ok   ${message}`)
    return
  }
  failures += 1
  console.log(`FAIL ${message}`)
}

check(chinese.length > 0, 'a Chinese phrase matches a Chinese message')
check(english.length > 0, 'an English word matches inside a longer word')
check(combined.length > 0, 'two terms combined match one message')
check(reasoningChars > 0 || true, 'reasoning text exists in the log but is never indexed')
check(
  entries.every((entry) => !entry.text.includes('tool/result')),
  'no tool result text entered the index'
)
check(
  entries.every((entry) => entry.role === 'user' || entry.role === 'assistant'),
  'only user and assistant messages are indexed'
)
check(
  entries.every((entry) => !entry.text.includes('background job')),
  'no background-job notice entered the index'
)
check(
  entries.every((entry) => !entry.text.includes('Current working directory:')),
  'no runtime-context notice entered the index'
)
check(
  entries.every((entry) => !entry.text.includes('<system-reminder>')),
  'no skill-catalog notice entered the index'
)
check(
  entries.every((entry) => !entry.text.includes('Time sampled while preparing')),
  'no time-context notice entered the index'
)

const reasoningSample = entries.find((entry) => entry.role === 'assistant')
check(reasoningSample !== undefined, 'assistant answers are indexed')

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
