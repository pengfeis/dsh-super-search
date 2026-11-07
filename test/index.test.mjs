/**
 * Drives the real SuperSearchIndex against real session logs through a fake
 * Host context: the same refresh, ranking, snippet, and title code the plugin
 * runs, without a running Harness.
 *
 * Usage: node test/index.test.mjs <session.jsonl> [...]
 */
import { readFileSync } from 'node:fs'
import { SuperSearchIndex } from '../index.js'

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: node test/index.test.mjs <session.jsonl> [...]')
  process.exit(2)
}

/** One parsed log per input path. */
const logs = files.map((file) => {
  const events = []
  let header
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    const record = JSON.parse(line)
    if (record.type === 'session') {
      header = record
      continue
    }
    if (typeof record.seq === 'number') events.push(record)
  }
  return { file, header, events }
})

const warn = []
let observeCalls = 0
/** Cold sessions stay out of the live store and are reached through persistence. */
const cold = new Set(logs.slice(0, 2).map((log) => log.header.id))
const ctx = {
  logger: { warn: (message) => warn.push(message) },
  sessions: {
    list: () => logs
      .filter((log) => !cold.has(log.header.id))
      .map((log) => ({
        id: log.header.id,
        header: { cwd: log.header.cwd, createdAt: log.header.createdAt },
        seq: log.events.length,
        snapshotEvents: () => log.events
      }))
  },
  get: (name) => (name === 'sessionPersistence' ? {
    list: async () => logs
      .filter((log) => cold.has(log.header.id))
      .map((log) => ({ header: { id: log.header.id, cwd: log.header.cwd, createdAt: log.header.createdAt }, revision: 'r1' }))
  } : undefined),
  sessionQuery: {
    observeSession: async (id) => {
      observeCalls += 1
      const log = logs.find((candidate) => candidate.header.id === id)
      if (log === undefined) throw new Error(`unknown session ${id}`)
      return { events: log.events, dispose: () => {} }
    },
    readTitle: async (id) => {
      const log = logs.find((candidate) => candidate.header.id === id)
      const titleEvent = log.events.find((event) => event.type === 'session/title')
      return titleEvent === undefined ? undefined : { title: titleEvent.data.title }
    }
  }
}

const index = new SuperSearchIndex(ctx)
const result = await index.search({ query: '插件' })
console.log(`sessions indexed: ${result.sessions}, messages searched: ${result.messages}, hits: ${result.hits.length}`)
for (const hit of result.hits.slice(0, 3)) {
  console.log(`- [${hit.role}] ${hit.title ?? '(untitled)'} | ${hit.snippet.replace(/\n/gu, ' ').slice(0, 120)}`)
}

let failures = 0
const check = (condition, message) => {
  if (condition) {
    console.log(`ok   ${message}`)
    return
  }
  failures += 1
  console.log(`FAIL ${message}`)
}

check(result.sessions === logs.length, 'every session entered the index')
check(result.hits.length > 0, 'a Chinese query returns hits through the real index')
check(result.hits.every((hit) => hit.sessionId !== undefined), 'hits carry their session id')
check(result.hits.every((hit) => typeof hit.snippet === 'string' && hit.snippet.length > 0), 'hits carry a snippet')
check(result.hits.every((hit) => hit.role === 'user' || hit.role === 'assistant'), 'hits are questions or answers')
check(result.hits.every((hit) => !hit.text.includes('Current working directory:')), 'no runtime context in hits')
check(result.hits.every((hit) => !hit.text.includes('background job')), 'no job notice in hits')
check(Array.isArray(result.hits) && result.hits.every((hit, position) => position === 0 || result.hits[position - 1].occurrences >= hit.occurrences), 'hits are ranked by occurrence count')

const scoped = await index.search({ query: '插件', cwd: '/nonexistent-workspace' })
check(scoped.hits.length === 0, 'a cwd filter excludes every other workspace')

const empty = await index.search({ query: '   ' })
check(empty.hits.length === 0 && empty.query === '', 'an empty query returns nothing')

const missing = await index.search({ query: 'zzzz-not-in-any-session-zzzz' })
check(missing.hits.length === 0, 'a query with no match returns no hits')

check(warn.length === 0, 'no session failed to index')
check(observeCalls === cold.size, 'each changed cold session was read exactly once')

const before = observeCalls
await index.search({ query: '插件' })
check(observeCalls === before, 'an unchanged corpus re-reads no cold session')

const live = await index.search({ query: '插件', sessionId: [...cold][0] })
check(live.hits.length > 0, 'cold sessions contribute hits')

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
