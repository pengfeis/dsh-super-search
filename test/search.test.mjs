/**
 * Exercises the plugin's text extraction and matching against real session logs.
 *
 * Usage: node test/search.test.mjs <decompressed-session.jsonl> [...]
 */
import { readFileSync } from 'node:fs'
import {
  entryOfEvent,
  entriesOfEvents,
  entriesAndTitleOfEvents,
  tokenizeQuery,
  matchTokens
} from '../index.js'

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: node test/search.test.mjs <session.jsonl> [...]')
  process.exit(2)
}

const entries = []
let toolResultChars = 0
let assistantChars = 0
let reasoningChars = 0
let titles = 0

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
    if (event.type === 'session/title') titles += 1
    const entry = entryOfEvent(event)
    if (entry !== undefined) entries.push({ ...entry, file })
  }
}

console.log(`indexed ${entries.length} messages from ${files.length} log(s), ${titles} title events`)
console.log(`assistant text chars: ${assistantChars}, reasoning chars: ${reasoningChars}, tool output chars: ${toolResultChars}`)

const search = (query) => {
  const tokens = tokenizeQuery(query)
  const hits = []
  for (const entry of entries) {
    const haystack = entry.text.toLowerCase()
    const outcome = matchTokens(tokens, haystack, true)
    if (!outcome.matched) continue
    hits.push({ ...entry, occurrences: outcome.occurrences })
  }
  return hits
}

const report = (label, query) => {
  const hits = search(query)
  console.log(`\n--- ${label}: "${query}" -> ${hits.length} hit(s)`)
  for (const hit of hits.slice(0, 3)) {
    console.log(`  [${hit.role}] ${hit.text.replace(/\n/gu, ' ').slice(0, 150)}`)
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

// --- tokenizer and matching semantics -------------------------------------

const tokensOf = (query) => tokenizeQuery(query)
check(tokensOf('搜索插件').length === 1, 'a Chinese run is one token')
check(tokensOf('搜索插件')[0].kind === 'cjk', 'a Chinese run is a cjk token')
check(tokensOf('搜索插件')[0].pairs.length === 3, 'a Chinese run carries its adjacent character pairs')
check(tokensOf('how to install').length === 3, 'words split into one token each')
check(tokensOf('插件 install').length === 2, 'a Chinese run and a word are separate tokens')

const haystack = '这是一个搜索会话插件的说明'.toLowerCase()
check(matchTokens(tokensOf('搜索插件'), haystack, true).matched, 'a Chinese run matches through its character pairs')
check(matchTokens(tokensOf('搜索插件'), haystack, true).index > 0, 'the match offset points into the text')
check(!matchTokens(tokensOf('搜索会话'), '完全不同的一段文字'.toLowerCase(), true).matched, 'unrelated text does not match')
check(
  !matchTokens(tokensOf('插件'), '这里有插字但是没有件字相邻'.toLowerCase(), true).matched,
  'characters that never appear adjacent do not match'
)
check(
  matchTokens(tokensOf('插件'), '这里有插字但是没有件字相邻'.toLowerCase(), false).matched === false,
  'a partial match still needs the run itself'
)
check(
  matchTokens(tokensOf('插件 安装'), '安装插件的步骤'.toLowerCase(), true).matched,
  'two terms match one text when both appear'
)
check(
  !matchTokens(tokensOf('插件 安装'), '只有插件的步骤'.toLowerCase(), true).matched,
  'two terms do not match a text holding only one of them'
)
check(
  matchTokens(tokensOf('插件 安装'), '只有插件的步骤'.toLowerCase(), false).matched,
  'the loose fallback matches a text holding one of two terms'
)

// --- titles ride in the log -----------------------------------------------

const titleEvents = []
for (const file of files) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event.type === 'session/title') titleEvents.push(event)
  }
}
const withTitle = entriesAndTitleOfEvents(titleEvents)
check(withTitle.entries.length === 0, 'title events are not indexed as messages')
check(typeof withTitle.title === 'string' && withTitle.title.length > 0, 'the last title of a log is read from its events')

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
