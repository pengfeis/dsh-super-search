/**
 * Drives the real SuperSearchIndex against real session logs through a fake
 * Host context: the same refresh, ranking, title, cross-session, and workspace
 * scope code the plugin runs, without a running Harness.
 *
 * Usage: node test/index.test.mjs <session.jsonl> [...]
 */
import { readFileSync } from 'node:fs'
import { SuperSearchIndex, tokenizeQuery } from '../index.js'

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: node test/index.test.mjs <session.jsonl> [...]')
  process.exit(2)
}

/**
 * One parsed log per input path, keeping at most one log per workspace so the
 * corpus really spans several working directories.
 */
const parsed = files.map((file, position) => {
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
  if (header === undefined) header = { id: `session-${position}`, cwd: `/tmp/workspace-${position}` }
  return { file, header, events }
})
const seenWorkspaces = new Set()
const logs = parsed.filter((log) => {
  if (seenWorkspaces.has(log.header.cwd)) return false
  seenWorkspaces.add(log.header.cwd)
  return true
})

const warn = []
let observeCalls = 0
let releasedObservations = 0
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
      // The real lease exposes the disposable symbol, not a named method.
      return {
        events: log.events,
        [Symbol.dispose]: () => {
          releasedObservations += 1
        }
      }
    },
    readTitle: async () => undefined
  }
}

const index = new SuperSearchIndex(ctx)
const result = await index.search({ query: '插件' })
console.log(`sessions indexed: ${result.sessions}, messages searched: ${result.messages}, hits: ${result.hits.length}`)
for (const hit of result.hits.slice(0, 3)) {
  console.log(`- [${hit.role}] ${hit.cwd ?? ''} | ${hit.snippet.replace(/\n/gu, ' ').slice(0, 110)}`)
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
check(result.hits.every((hit) => hit.role === 'user' || hit.role === 'assistant' || hit.role === 'title'), 'hits are questions, answers, or titles')
check(result.hits.every((hit) => !hit.text.includes('Current working directory:')), 'no runtime context in hits')
check(result.hits.every((hit) => !hit.text.includes('background job')), 'no job notice in hits')
check(result.hits.every((hit) => typeof hit.score === 'number'), 'hits carry a score')
check(
  result.hits.every((hit, position) => position === 0 || result.hits[position - 1].score >= hit.score),
  'hits are ranked by score'
)

// --- cross-session ---------------------------------------------------------

const crossSession = await index.search({ query: '插件' })
check(
  crossSession.hits.every((hit) => typeof hit.cwd === 'string' || hit.cwd === undefined),
  'hits carry their workspace'
)

// A word the corpus holds in more than one session must reach both of them.
const sessionsOfWord = new Map()
for (const [sessionId, session] of index.index) {
  for (const entry of session.entries) {
    for (const token of tokenizeQuery(entry.text)) {
      if (token.text.length < 3) continue
      const owners = sessionsOfWord.get(token.text) ?? new Set()
      owners.add(sessionId)
      sessionsOfWord.set(token.text, owners)
    }
  }
}
const shared = [...sessionsOfWord.entries()].sort((left, right) => right[1].size - left[1].size)[0]
check(shared !== undefined && shared[1].size > 1, 'the corpus holds a word that appears in more than one session')
if (shared !== undefined) {
  const spanning = await index.search({ query: shared[0] })
  const sessions = new Set(spanning.hits.map((hit) => hit.sessionId))
  check(sessions.size > 1, `one query reaches more than one session ("${shared[0]}" reached ${String(sessions.size)})`)
}

// --- workspace scope -------------------------------------------------------

const workspaces = index.workspaces()
check(workspaces.length >= 2, 'the corpus reports more than one workspace')
check(workspaces.every((row) => row.sessions >= 1), 'every workspace counts its sessions')

const oneWorkspace = workspaces[0].cwd
const scoped = await index.search({ query: '插件', workspace: oneWorkspace })
check(
  scoped.hits.every((hit) => hit.cwd === oneWorkspace),
  'a workspace scope keeps only that workspace'
)
check(scoped.sessions < crossSession.sessions, 'a workspace scope searches fewer sessions')

const all = await index.search({ query: '插件', workspace: 'all' })
check(all.sessions === crossSession.sessions, 'the "all" scope searches every session')

const other = await index.search({ query: '插件', workspace: '/nonexistent-workspace' })
check(other.hits.length === 0 && other.sessions === 0, 'an unknown workspace matches nothing')

// --- titles ----------------------------------------------------------------

const titled = logs.find((log) => log.events.some((event) => event.type === 'session/title'))
if (titled !== undefined) {
  const title = titled.events.filter((event) => event.type === 'session/title').pop().data.title
  const byTitle = await index.search({ query: title })
  check(byTitle.hits.length > 0, 'a session is found by its own title')
  check(
    byTitle.hits.some((hit) => hit.role === 'title'),
    'a title hit is reported as a title'
  )
} else {
  check(true, 'a session is found by its own title (no titled log in this sample)')
  check(true, 'a title hit is reported as a title (no titled log in this sample)')
}

// --- loose fallback --------------------------------------------------------

const nothing = await index.search({ query: 'zzzz-not-in-any-session-zzzz' })
check(nothing.hits.length === 0, 'a query with no match returns no hits')
check(nothing.loose === false, 'a query with no match is not a loose match')

// --- empty query and caching ----------------------------------------------

const empty = await index.search({ query: '   ' })
check(empty.hits.length === 0 && empty.query === '', 'an empty query returns nothing')

const before = observeCalls
await index.search({ query: '插件' })
check(observeCalls === before, 'an unchanged corpus re-reads no cold session')
check(
  releasedObservations === observeCalls,
  'every session observation was released through Symbol.dispose'
)
check(warn.length === 0, 'no session failed to index')

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
