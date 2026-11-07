/**
 * dsh-super-search — global search over the conversations this Harness keeps.
 *
 * The searchable corpus is deliberately narrow: only the text a human typed
 * (user questions) and the text the model answered with (assistant answers).
 * Reasoning ("thinking") blocks, tool calls, and tool output never enter the
 * index, so a hit is always something a person actually wrote or read.
 *
 * The index is a derived cache over the session log — the log stays the single
 * source of truth. Cold sessions are re-read only when their persistence
 * revision changes; live sessions are extended with the events appended since
 * the last scan.
 */

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'dsh-super-search'

/** Host services this plugin needs. */
export const inject = ['sessionQuery', 'sessions', 'sessionPersistence', 'tools']

/** Default number of hits one search returns. */
const DEFAULT_MAX_RESULTS = 50

/** Default number of characters kept before and after the first match. */
const DEFAULT_SNIPPET_RADIUS = 120

/** Longest query accepted. */
const MAX_QUERY_LENGTH = 512

/** Stored sessions read at once while a search refreshes the index. */
const COLD_READ_CONCURRENCY = 4

/** Path the browser half reads its results from. */
const SEARCH_PATH = '/api/super-search'

/**
 * Extract the searchable text of one message.
 *
 * Only `text` blocks count. `reasoning` blocks (the model's detailed
 * thinking), `tool-call` blocks (the arguments a tool was called with), and
 * every other block kind are excluded by construction.
 *
 * @param {unknown} content - the message content block list.
 * @returns {string} the joined text blocks, trimmed.
 */
function extractPlainText(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    if (block.type !== 'text') continue
    if (typeof block.text !== 'string') continue
    const text = block.text.trim()
    if (text !== '') parts.push(text)
  }
  return parts.join('\n')
}

/**
 * Project one session event onto a searchable entry.
 *
 * Only two kinds of message qualify: a message a human typed, and the text an
 * assistant answered with. The Harness also delivers runtime context, time
 * stamps, skill catalogs, and background-job notices in the user role; those
 * carry a different source and are left out, so a hit is always something a
 * person asked or read.
 *
 * @param {any} event - a session event.
 * @returns {{seq: number, role: 'user' | 'assistant', time: number, text: string} | undefined} the entry, or undefined for events that carry no answer text.
 */
function entryOfEvent(event) {
  if (event === null || typeof event !== 'object') return undefined
  if (event.type === 'user/message') {
    const source = event.data?.source
    if (source !== undefined && source !== null && source.kind !== 'user') return undefined
    const text = extractPlainText(event.data?.content)
    if (text === '') return undefined
    return { seq: event.seq, role: 'user', time: event.time, text }
  }
  if (event.type === 'assistant/message') {
    const message = event.data?.message
    const source = message?.source
    if (source !== undefined && source !== null && source.kind !== 'model') return undefined
    const text = extractPlainText(message?.content)
    if (text === '') return undefined
    return { seq: event.seq, role: 'assistant', time: event.time, text }
  }
  return undefined
}

/**
 * Extract every searchable entry of one event list.
 *
 * @param {readonly any[]} events - the session events.
 * @returns {Array<{seq: number, role: 'user' | 'assistant', time: number, text: string}>} the entries.
 */
function entriesOfEvents(events) {
  const entries = []
  for (const event of events) {
    const entry = entryOfEvent(event)
    if (entry !== undefined) entries.push(entry)
  }
  return entries
}

/**
 * Split a query into the terms every hit must contain.
 *
 * A single term matches inside a word, so Chinese phrases and partial English
 * words are found; several terms are combined with AND.
 *
 * @param {string} query - the raw query.
 * @returns {string[]} the lowercased terms.
 */
function termsOf(query) {
  return query
    .toLowerCase()
    .split(/\s+/u)
    .map((term) => term.trim())
    .filter((term) => term !== '')
}

/**
 * Cut the text around the first match.
 *
 * @param {string} text - the matched message text.
 * @param {number} index - the offset of the first match.
 * @param {number} length - the matched length.
 * @param {number} radius - characters kept on each side.
 * @returns {string} the snippet, with ellipses where text was cut.
 */
function snippetAround(text, index, length, radius) {
  const start = Math.max(0, index - radius)
  const end = Math.min(text.length, index + length + radius)
  const head = start > 0 ? '…' : ''
  const tail = end < text.length ? '…' : ''
  return `${head}${text.slice(start, end).trim()}${tail}`
}

/**
 * The searchable view over every conversation of this Harness.
 */
class SuperSearchIndex {
  /**
   * @param {any} ctx - the plugin context.
   */
  constructor(ctx) {
    this.ctx = ctx
    /** @type {Map<string, {version: string, live: boolean, cwd: string | undefined, createdAt: number, lastSeq: number, entries: any[]}>} */
    this.index = new Map()
    /** @type {Map<string, string | undefined>} */
    this.titles = new Map()
    this.refreshing = undefined
  }

  /**
   * The live-preferred corpus of this Harness.
   *
   * @returns {Promise<Array<{id: string, cwd: string | undefined, createdAt: number, live: boolean, revision: string | undefined, session: any}>>} one record per known session.
   */
  async corpus() {
    const records = new Map()
    for (const session of this.ctx.sessions.list()) {
      records.set(session.id, {
        id: session.id,
        cwd: session.header?.cwd,
        createdAt: session.header?.createdAt ?? 0,
        live: true,
        revision: undefined,
        session
      })
    }
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence !== undefined && persistence !== null) {
      const snapshots = await persistence.list()
      for (const snapshot of snapshots) {
        const id = snapshot.header?.id
        if (typeof id !== 'string') continue
        const existing = records.get(id)
        if (existing !== undefined) {
          existing.revision = snapshot.revision
          continue
        }
        records.set(id, {
          id,
          cwd: snapshot.header?.cwd,
          createdAt: snapshot.header?.createdAt ?? 0,
          live: false,
          revision: snapshot.revision,
          session: undefined
        })
      }
    }
    return [...records.values()]
  }

  /**
   * Read one cold session and index its answers.
   *
   * @param {string} id - the session id.
   * @returns {Promise<any[]>} the entries of that session.
   */
  async entriesOfColdSession(id) {
    const observation = await this.ctx.sessionQuery.observeSession(id, { projectionMode: 'none' })
    try {
      return entriesOfEvents(observation.events)
    } finally {
      observation.dispose()
    }
  }

  /**
   * Bring the index in line with the corpus.
   *
   * Live sessions are extended with the events appended since the last scan;
   * cold sessions are re-read only when their persistence revision changed.
   *
   * @returns {Promise<void>} settlement after the index matches the corpus.
   */
  async refresh() {
    if (this.refreshing !== undefined) {
      await this.refreshing
      return
    }
    const run = this.performRefresh().finally(() => {
      this.refreshing = undefined
    })
    this.refreshing = run
    await run
  }

  /**
   * The refresh body, without the single-flight guard.
   *
   * @returns {Promise<void>} settlement after the index matches the corpus.
   */
  async performRefresh() {
    const records = await this.corpus()
    const seen = new Set()
    const coldWork = []
    for (const record of records) {
      seen.add(record.id)
      const version = record.live ? `live:${String(record.session?.seq ?? -1)}` : `store:${String(record.revision ?? '')}`
      const cached = this.index.get(record.id)
      if (cached !== undefined && cached.version === version) continue
      if (!record.live) {
        coldWork.push(record)
        continue
      }
      const events = record.session?.snapshotEvents?.() ?? []
      const from = cached !== undefined && cached.live === true ? cached.lastSeq : -1
      const entries = cached !== undefined && cached.live === true ? [...cached.entries] : []
      let lastSeq = from
      for (const event of events) {
        if (event.seq <= from) continue
        const entry = entryOfEvent(event)
        if (entry !== undefined) entries.push(entry)
        lastSeq = event.seq
      }
      this.index.set(record.id, {
        version,
        live: true,
        cwd: record.cwd,
        createdAt: record.createdAt,
        lastSeq,
        entries
      })
    }
    await this.readColdSessions(coldWork)
    for (const id of [...this.index.keys()]) {
      if (!seen.has(id)) {
        this.index.delete(id)
        this.titles.delete(id)
      }
    }
  }

  /**
   * Read the changed cold sessions with bounded concurrency.
   *
   * A first search reads the whole stored corpus, so the reads run a few at a
   * time rather than one after another; each session is applied as it settles,
   * and one unreadable session never stops the rest.
   *
   * @param {Array<{id: string, cwd: string | undefined, createdAt: number, revision: string | undefined}>} records - the sessions to (re)read.
   * @returns {Promise<void>} settlement after every session settled.
   */
  async readColdSessions(records) {
    let next = 0
    const workers = Array.from({ length: Math.min(COLD_READ_CONCURRENCY, records.length) }, async () => {
      for (;;) {
        const position = next
        next += 1
        if (position >= records.length) return
        const record = records[position]
        try {
          const entries = await this.entriesOfColdSession(record.id)
          this.index.set(record.id, {
            version: `store:${String(record.revision ?? '')}`,
            live: false,
            cwd: record.cwd,
            createdAt: record.createdAt,
            lastSeq: entries.length === 0 ? -1 : entries[entries.length - 1].seq,
            entries
          })
        } catch (error) {
          this.ctx.logger?.warn?.(`dsh-super-search: session "${record.id}" could not be indexed: ${String(error)}`)
        }
      }
    })
    await Promise.all(workers)
  }

  /**
   * The folded title of one session, read once and then remembered.
   *
   * @param {string} id - the session id.
   * @returns {Promise<string | undefined>} the title, when the log carries one.
   */
  async titleOf(id) {
    if (this.titles.has(id)) return this.titles.get(id)
    let title
    try {
      title = (await this.ctx.sessionQuery.readTitle(id))?.title
    } catch {
      title = undefined
    }
    this.titles.set(id, title)
    return title
  }

  /**
   * Search every indexed conversation.
   *
   * @param {{query: string, sessionId?: string, cwd?: string, limit?: number, snippetRadius?: number}} request - the search request.
   * @returns {Promise<any>} the hits, the corpus size, and the query that was run.
   */
  async search(request) {
    const query = typeof request?.query === 'string' ? request.query.trim().slice(0, MAX_QUERY_LENGTH) : ''
    if (query === '') {
      return { query: '', hits: [], sessions: 0, messages: 0, truncated: false }
    }
    await this.refresh()
    const terms = termsOf(query)
    if (terms.length === 0) {
      return { query: '', hits: [], sessions: this.index.size, messages: 0, truncated: false }
    }
    const limit = Number.isInteger(request?.limit) && request.limit > 0 ? Math.min(request.limit, 200) : DEFAULT_MAX_RESULTS
    const radius = Number.isInteger(request?.snippetRadius) && request.snippetRadius > 0 ? request.snippetRadius : DEFAULT_SNIPPET_RADIUS
    const hits = []
    let messages = 0
    for (const [id, session] of this.index) {
      if (typeof request?.sessionId === 'string' && request.sessionId !== id) continue
      if (typeof request?.cwd === 'string' && request.cwd !== session.cwd) continue
      for (const entry of session.entries) {
        messages += 1
        const haystack = entry.text.toLowerCase()
        let index = -1
        let occurrences = 0
        let matched = true
        for (const term of terms) {
          const at = haystack.indexOf(term)
          if (at < 0) {
            matched = false
            break
          }
          if (index < 0 || at < index) index = at
          let from = 0
          for (;;) {
            const found = haystack.indexOf(term, from)
            if (found < 0) break
            occurrences += 1
            from = found + term.length
          }
        }
        if (!matched) continue
        hits.push({
          sessionId: id,
          cwd: session.cwd,
          role: entry.role,
          seq: entry.seq,
          time: entry.time,
          text: entry.text,
          snippet: snippetAround(entry.text, index, terms[0].length, radius),
          occurrences
        })
      }
    }
    hits.sort((left, right) => right.occurrences - left.occurrences || right.time - left.time)
    const truncated = hits.length > limit
    const selected = hits.slice(0, limit)
    for (const hit of selected) {
      hit.title = await this.titleOf(hit.sessionId)
    }
    return {
      query,
      hits: selected,
      sessions: this.index.size,
      messages,
      truncated
    }
  }
}

/**
 * Render search results as the plain text the model reads.
 *
 * @param {any} result - the search result.
 * @returns {string} the rendered text.
 */
function renderToolResult(result) {
  if (result.hits.length === 0) {
    return `No conversation matched "${result.query}". ${String(result.messages)} messages were searched across ${String(result.sessions)} sessions.`
  }
  const lines = [`${String(result.hits.length)} match(es) for "${result.query}" across ${String(result.sessions)} sessions:`, '']
  for (const hit of result.hits) {
    const who = hit.role === 'user' ? 'User' : 'Assistant'
    const when = new Date(hit.time).toISOString()
    lines.push(`- [${who}] session ${hit.sessionId}${hit.title === undefined ? '' : ` ("${hit.title}")`} at ${when} (seq ${String(hit.seq)})`)
    lines.push(`  ${hit.snippet.replace(/\n/gu, ' ')}`)
  }
  if (result.truncated) lines.push('', 'More matches exist; narrow the query to see them.')
  return lines.join('\n')
}

/**
 * Mount the search service, the model-facing tool, and the browser entry point.
 *
 * @param {any} ctx - the plugin context.
 * @param {any} config - the row configuration.
 * @returns {void} nothing; the plugin owns its registrations through the context.
 */
export function apply(ctx, config = {}) {
  const index = new SuperSearchIndex(ctx)
  const maxResults = Number.isInteger(config.maxResults) && config.maxResults > 0 ? config.maxResults : DEFAULT_MAX_RESULTS

  /**
   * The one operation this plugin owns: search the human-readable part of the
   * conversation history. The tool and the browser entry point both call it.
   *
   * @param {{query: string, sessionId?: string, cwd?: string, limit?: number}} request - the search request.
   * @returns {Promise<any>} the search result.
   */
  const search = async (request) => index.search({ ...request, limit: request?.limit ?? maxResults })

  ctx.provide('superSearch', { search })

  ctx.tools.register({
    name: 'super_search',
    description: 'Search the text of earlier conversations in this workspace. Only what a person typed and what the assistant answered are searched; reasoning, tool calls, and tool output are excluded.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Literal text to look for. Matching is case-insensitive and works inside words and Chinese phrases.'
        }
      },
      required: ['query'],
      additionalProperties: false
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }]
    },
    execute: async (args, exec) => {
      const query = typeof args?.query === 'string' ? args.query.trim() : ''
      if (query === '') throw new Error('super_search: query must not be empty')
      const cwd = exec?.agent?.session?.header?.cwd
      const result = await search({ query, cwd: typeof cwd === 'string' ? cwd : undefined })
      return renderToolResult(result)
    }
  })

  ctx.inject(['webServer', 'connection'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: SEARCH_PATH,
      handler: async (req, res) => {
        const admission = webCtx.connection.admit(req)
        if ('rejection' in admission) {
          res.writeHead(admission.rejection, { 'content-type': 'text/plain; charset=utf-8' })
          res.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden')
          return
        }
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const limit = Number.parseInt(url.searchParams.get('limit') ?? '', 10)
          const result = await search({
            query: url.searchParams.get('q') ?? '',
            sessionId: url.searchParams.get('sessionId') ?? undefined,
            cwd: url.searchParams.get('cwd') ?? undefined,
            limit: Number.isInteger(limit) && limit > 0 ? limit : undefined
          })
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify(result))
        } catch (error) {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
        }
      }
    }), 'dsh-super-search: search route')
  })
}

/** The pure text helpers, exported so a test can exercise them against real logs. */
export { SuperSearchIndex, extractPlainText, entryOfEvent, entriesOfEvents, termsOf, snippetAround }
