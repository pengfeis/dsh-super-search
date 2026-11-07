window.__ModuleLoader__.load({
  id: 'dsh-super-search',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React

    /** Dictionary namespace owned by this plugin. */
    const NS = 'superSearch'

    /** Host route that answers one search. */
    const SEARCH_PATH = 'api/super-search'

    /** Milliseconds the query rests before the host is asked. */
    const DEBOUNCE_MS = 180

    /** Hits rendered at once; the rest stay behind the count. */
    const MAX_VISIBLE = 40

    /** English copy. */
    const en = {
      title: 'Super search',
      description: 'Search every conversation in this Harness by what people asked and what the assistant answered.',
      open: 'Search conversations',
      placeholder: 'Search questions and answers',
      scope: 'Questions and answers only',
      searching: 'Searching…',
      idle: 'Type to search the conversation history.',
      empty: 'Nothing matched this text.',
      emptyHint: 'Only what people typed and what the assistant answered is searched — not reasoning, tool calls, or tool output.',
      failed: 'The search could not be completed.',
      matches: 'matches',
      sessions: 'sessions',
      messages: 'messages',
      user: 'You',
      assistant: 'Assistant',
      untitled: 'Untitled conversation',
      hint: 'Enter opens the conversation · Esc closes'
    }

    /** Simplified Chinese copy. */
    const zh = {
      title: '全局搜索',
      description: '按用户提问与助手回答的内容，搜索本 Harness 中的全部会话。',
      open: '搜索会话',
      placeholder: '搜索提问与回答',
      scope: '仅包含提问与回答',
      searching: '搜索中…',
      idle: '输入内容以搜索历史会话。',
      empty: '没有匹配的内容。',
      emptyHint: '仅搜索用户输入的问题与助手的回答，不包含思考过程、工具调用与工具输出。',
      failed: '搜索未能完成。',
      matches: '条匹配',
      sessions: '个会话',
      messages: '条消息',
      user: '用户',
      assistant: '助手',
      untitled: '未命名会话',
      hint: '回车打开会话 · Esc 关闭'
    }

    /**
     * The palette's open state, with a generation that advances on every open.
     *
     * The generation keys the palette body, so opening the palette mounts a
     * fresh body: the previous query, hits, selection, and any request still in
     * flight belong to the previous run and cannot leak into the new one.
     *
     * @param {boolean} initial - the initial open state.
     * @returns {any} the store.
     */
    function createOpenStore(initial) {
      let value = { open: initial, generation: 0 }
      const listeners = new Set()
      const set = (next) => {
        if (next.open === value.open && next.generation === value.generation) return
        value = next
        for (const listener of [...listeners]) listener()
      }
      return {
        getSnapshot: () => value,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        open() {
          // A second open while the palette is already up keeps the current run;
          // only a fresh open starts a new generation with empty state.
          if (value.open) return
          set({ open: true, generation: value.generation + 1 })
        },
        close() {
          set({ open: false, generation: value.generation })
        }
      }
    }

    /**
     * Escape one text for use inside a regular expression.
     *
     * @param {string} value - the raw text.
     * @returns {string} the escaped text.
     */
    function escapeRegExp(value) {
      return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    }

    /**
     * Split a snippet so the matched terms can be marked.
     *
     * @param {string} text - the snippet.
     * @param {string} query - the raw query.
     * @returns {Array<{text: string, marked: boolean}>} the segments.
     */
    function segmentsOf(text, query) {
      const terms = query
        .toLowerCase()
        .split(/\s+/u)
        .filter((term) => term !== '')
      if (terms.length === 0) return [{ text, marked: false }]
      const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'giu')
      const segments = []
      let index = 0
      for (const match of text.matchAll(pattern)) {
        const at = match.index ?? 0
        if (at > index) segments.push({ text: text.slice(index, at), marked: false })
        segments.push({ text: match[0], marked: true })
        index = at + match[0].length
      }
      if (index < text.length) segments.push({ text: text.slice(index), marked: false })
      return segments
    }

    /**
     * Render one snippet with its matched terms marked.
     *
     * @param {string} text - the snippet.
     * @param {string} query - the raw query.
     * @returns {any} the rendered snippet.
     */
    function renderSnippet(text, query) {
      return h(
        'span',
        null,
        segmentsOf(text, query).map((segment, index) =>
          segment.marked
            ? h('mark', { key: index, style: { background: 'transparent', color: 'var(--dsw-alias-brand-primary)', fontWeight: 600 } }, segment.text)
            : h('span', { key: index }, segment.text)
        )
      )
    }

    /**
     * Format one timestamp for the result list.
     *
     * @param {number} time - the epoch milliseconds.
     * @returns {string} the formatted time.
     */
    function formatTime(time) {
      const date = new Date(time)
      if (Number.isNaN(date.getTime())) return ''
      const today = new Date()
      const sameDay = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate()
      return sameDay
        ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
        : date.toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })
    }

    /** The card and its rows share these measurements. */
    const CARD = {
      width: 'min(760px, 92vw)',
      maxHeight: 'min(560px, 70vh)',
      radius: 14
    }

    /** What one search run renders while it has no result yet. */
    const EMPTY_RESULT = { status: 'idle', hits: [], sessions: 0, messages: 0, truncated: false, error: undefined }

    /**
     * One search run: the query field and the matching messages.
     *
     * The body is keyed by the store's open generation, so every open mounts a
     * new instance with empty state and starts its own request sequence.
     *
     * @param {any} props - the injected face plus the close and navigate callbacks.
     * @returns {any} the palette card.
     */
    function PaletteBody(props) {
      const { t, onClose, onOpenSession } = props
      const [query, setQuery] = useState('')
      const [result, setResult] = useState(EMPTY_RESULT)
      const [selected, setSelected] = useState(0)
      const [hovered, setHovered] = useState(-1)
      const inputRef = useRef(null)
      const requestRef = useRef(0)

      useEffect(() => {
        const input = inputRef.current
        if (input !== null) input.focus()
      }, [])

      useEffect(() => {
        const text = query.trim()
        if (text === '') {
          requestRef.current += 1
          setResult(EMPTY_RESULT)
          return undefined
        }
        const timer = setTimeout(() => {
          const id = requestRef.current + 1
          requestRef.current = id
          setResult((previous) => ({ ...previous, status: 'loading', error: undefined }))
          const url = new URL(SEARCH_PATH, document.baseURI)
          url.searchParams.set('q', text)
          fetch(url.href, { credentials: 'same-origin' })
            .then((response) => {
              if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
              return response.json()
            })
            .then((data) => {
              if (id !== requestRef.current) return
              setResult({
                status: 'ready',
                hits: Array.isArray(data?.hits) ? data.hits : [],
                sessions: Number(data?.sessions ?? 0),
                messages: Number(data?.messages ?? 0),
                truncated: data?.truncated === true,
                error: undefined
              })
              setSelected(0)
            })
            .catch((error) => {
              if (id !== requestRef.current) return
              setResult({ status: 'failed', hits: [], sessions: 0, messages: 0, truncated: false, error: error instanceof Error ? error.message : String(error) })
            })
        }, DEBOUNCE_MS)
        return () => clearTimeout(timer)
      }, [query])

      const hits = useMemo(() => result.hits.slice(0, MAX_VISIBLE), [result.hits])

      const openHit = useCallback((hit) => {
        if (hit === undefined) return
        onOpenSession(hit.sessionId)
        onClose()
      }, [onClose, onOpenSession])

      const onKeyDown = useCallback((event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
          return
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setSelected((current) => Math.min(current + 1, Math.max(hits.length - 1, 0)))
          return
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          setSelected((current) => Math.max(current - 1, 0))
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          openHit(hits[selected])
        }
      }, [hits, onClose, openHit, selected])

      const cardStyle = {
        width: CARD.width,
        maxHeight: CARD.maxHeight,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--dsw-alias-bg-overlay)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: `${String(CARD.radius)}px`,
        boxShadow: '0 24px 64px rgba(0, 0, 0, 0.28)'
      }

      const inputStyle = {
        flex: 1,
        minWidth: 0,
        border: 'none',
        outline: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 15,
        lineHeight: '22px',
        padding: '14px 16px'
      }

      const metaStyle = {
        display: 'flex',
        gap: '10px',
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: '0 16px 10px',
        fontSize: 12,
        lineHeight: '16px',
        color: 'var(--dsw-alias-label-secondary)'
      }

      const listStyle = {
        overflowY: 'auto',
        padding: '0 8px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px'
      }

      const rowStyle = (active) => ({
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        border: '1px solid transparent',
        borderRadius: '10px',
        padding: '10px 12px',
        background: active ? 'var(--dsw-alias-bg-layer-1)' : 'transparent'
      })

      const badgeStyle = {
        fontSize: 11,
        lineHeight: '16px',
        padding: '1px 6px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border-l1)',
        color: 'var(--dsw-alias-label-secondary)',
        whiteSpace: 'nowrap'
      }

      return h(
        'div',
        { style: cardStyle, role: 'dialog', 'aria-modal': 'true', 'aria-label': t('title'), onKeyDown },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--dsw-alias-border-l1)' } },
          h('input', {
            ref: inputRef,
            type: 'search',
            value: query,
            placeholder: t('placeholder'),
            'aria-label': t('placeholder'),
            style: inputStyle,
            onChange: (event) => setQuery(event.target.value)
          }),
          h(
            'button',
            {
              type: 'button',
              'aria-label': t('open'),
              title: t('open'),
              onClick: onClose,
              style: {
                marginRight: '12px',
                border: 'none',
                background: 'transparent',
                color: 'var(--dsw-alias-label-secondary)',
                fontSize: 18,
                lineHeight: '20px',
                cursor: 'pointer'
              }
            },
            '×'
          )
        ),
        h(
          'div',
          { style: metaStyle },
          h('span', null, t('scope')),
          result.status === 'ready'
            ? h('span', null, `${String(result.hits.length)} ${t('matches')} · ${String(result.sessions)} ${t('sessions')} · ${String(result.messages)} ${t('messages')}`)
            : null,
          result.truncated ? h('span', null, `+${String(Math.max(result.hits.length - MAX_VISIBLE, 0))}`) : null
        ),
        h(
          'div',
          { style: listStyle },
          result.status === 'idle'
            ? h('div', { style: { padding: '18px 12px', color: 'var(--dsw-alias-label-secondary)', fontSize: 13 } }, t('idle'))
            : null,
          result.status === 'loading'
            ? h('div', { style: { padding: '18px 12px', color: 'var(--dsw-alias-label-secondary)', fontSize: 13 } }, t('searching'))
            : null,
          result.status === 'failed'
            ? h('div', { style: { padding: '18px 12px', color: 'var(--dsw-alias-state-error-primary)', fontSize: 13 } }, `${t('failed')} ${result.error ?? ''}`)
            : null,
          result.status === 'ready' && result.hits.length === 0
            ? h(
                'div',
                { style: { padding: '18px 12px', color: 'var(--dsw-alias-label-secondary)', fontSize: 13 } },
                h('div', null, t('empty')),
                h('div', { style: { marginTop: '4px', opacity: 0.8 } }, t('emptyHint'))
              )
            : null,
          hits.map((hit, index) =>
            h(
              'button',
              {
                key: `${hit.sessionId}:${String(hit.seq)}`,
                type: 'button',
                style: rowStyle(index === selected || index === hovered),
                onMouseEnter: () => setHovered(index),
                onMouseLeave: () => setHovered(-1),
                onFocus: () => setSelected(index),
                onClick: () => openHit(hit)
              },
              h(
                'div',
                { style: { display: 'flex', gap: '8px', alignItems: 'center', minWidth: 0 } },
                h('span', { style: badgeStyle }, hit.role === 'user' ? t('user') : t('assistant')),
                h(
                  'span',
                  { style: { fontSize: 13, lineHeight: '18px', color: 'var(--dsw-alias-label-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                  hit.title === undefined || hit.title === '' ? t('untitled') : hit.title
                ),
                h('span', { style: { marginLeft: 'auto', fontSize: 11, color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' } }, formatTime(hit.time))
              ),
              h(
                'div',
                { style: { fontSize: 13, lineHeight: '19px', color: 'var(--dsw-alias-label-secondary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } },
                renderSnippet(hit.snippet ?? '', query)
              )
            )
          )
        ),
        h(
          'div',
          { style: { padding: '8px 16px 12px', fontSize: 11, color: 'var(--dsw-alias-label-secondary)', borderTop: '1px solid var(--dsw-alias-border-l1)' } },
          t('hint')
        )
      )
    }

    /**
     * The palette seat: mounts one body per open, so no state outlives a run.
     *
     * @param {any} props - the injected face.
     * @returns {any} the overlay, or null while closed.
     */
    function SuperSearchPalette(props) {
      const { t, openStore, onOpenSession } = props
      const { open, generation } = useSyncExternalStore(openStore.subscribe, openStore.getSnapshot, openStore.getSnapshot)
      const close = useCallback(() => openStore.close(), [openStore])

      if (!open) return null

      const backdropStyle = {
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
        background: 'rgba(0, 0, 0, 0.32)',
        zIndex: 100
      }

      return ReactDOM.createPortal(
        h(
          'div',
          {
            style: backdropStyle,
            onMouseDown: (event) => {
              if (event.target === event.currentTarget) close()
            }
          },
          h(PaletteBody, { key: generation, t, onClose: close, onOpenSession })
        ),
        document.body
      )
    }

    /**
     * The sidebar entry that opens the palette.
     *
     * @param {any} props - the injected face.
     * @returns {any} the button element.
     */
    function SuperSearchEntry(props) {
      const { t, onOpen, wide } = props
      return h(
        'button',
        {
          type: 'button',
          onClick: onOpen,
          title: t('open'),
          'aria-label': t('open'),
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            width: '100%',
            border: 'none',
            background: 'transparent',
            color: 'var(--dsw-alias-label-secondary)',
            fontSize: 13,
            lineHeight: '18px',
            padding: '6px 10px',
            borderRadius: '8px',
            cursor: 'pointer',
            textAlign: 'left'
          }
        },
        h(
          'svg',
          { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true', style: { flex: '0 0 auto', display: 'block' } },
          h('circle', { cx: 7, cy: 7, r: 4.5, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }),
          h('path', { d: 'M10.5 10.5 L14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' })
        ),
        wide === false ? null : h('span', null, t('open'))
      )
    }

    /** Required services (cordis fiber inject). */
    const inject = ['slots', 'locale', 'uiWorkspace', 'shortcuts']

    /**
     * Mount the palette, its sidebar entry, and its shortcut.
     *
     * @param {any} ctx - the browser plugin context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'ui-super-search: dictionaries')

      const openStore = createOpenStore(false)
      const open = () => openStore.open()
      const openSession = (sessionId) => {
        ctx.uiWorkspace.openSession(sessionId)
      }

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'super-search',
        locale: NS,
        inject: () => ({ openStore, onOpenSession: openSession })
      }, SuperSearchPalette))

      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'super-search',
        order: 10,
        locale: NS,
        inject: () => ({ onOpen: open })
      }, SuperSearchEntry))

      ctx.effect(() => {
        try {
          return ctx.shortcuts.register({
            id: 'super-search.open',
            label: () => t('open'),
            aliases: ['super search', 'search conversations'],
            defaults: {
              'desktop:macos': { code: 'KeyK', modifiers: ['primary', 'shift'] },
              'desktop:windows': { code: 'KeyK', modifiers: ['primary', 'shift'] },
              'desktop:linux': { code: 'KeyK', modifiers: ['primary', 'shift'] },
              'web:macos': { code: 'KeyK', modifiers: ['primary', 'shift'] },
              'web:windows': { code: 'KeyK', modifiers: ['primary', 'shift'] }
            },
            regions: ['page', 'editable'],
            modals: [],
            resolve: () => ({ status: 'handled', run: open })
          })
        } catch (error) {
          ctx.logger?.warn?.(`dsh-super-search: the keyboard shortcut was not registered: ${String(error)}`)
          return undefined
        }
      }, 'ui-super-search: shortcut')
    }

    return { inject, apply }
  }
})
