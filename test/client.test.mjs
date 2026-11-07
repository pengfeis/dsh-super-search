/**
 * Exercises the browser half without a DOM: the module wiring, the open store's
 * generation, and the fresh body every open mounts.
 *
 * Usage: node test/client.test.mjs
 */

/** Minimal React stand-in: hooks resolve synchronously, elements stay inspectable. */
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useCallback: (fn) => fn,
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: (initial) => ({ current: initial }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot()
}

/** Capture the module definition the bundle registers. */
let definition
globalThis.window = {
  __ModuleLoader__: {
    load: (candidate) => {
      definition = candidate
    }
  }
}
globalThis.document = { body: {}, baseURI: 'http://127.0.0.1:1234/' }

await import('../client.js')

let failures = 0
const check = (condition, message) => {
  if (condition) {
    console.log(`ok   ${message}`)
    return
  }
  failures += 1
  console.log(`FAIL ${message}`)
}

check(definition !== undefined && definition.id === 'dsh-super-search', 'the bundle registers its module id')

const module = definition.factory((specifier) => {
  if (specifier === 'react') return React
  if (specifier === 'react-dom') return { createPortal: (element) => ({ portal: element }) }
  throw new Error(`unexpected require(${JSON.stringify(specifier)})`)
})

check(Array.isArray(module.inject) && module.inject.includes('slots'), 'the module declares its services')
check(typeof module.apply === 'function', 'the module exports apply')

/** Record every interaction with the plugin context. */
const record = { slots: [], locale: [], shortcuts: [], opened: undefined, warned: [] }
const ctx = {
  effect: (fn) => fn(),
  locale: {
    bind: () => (key) => key,
    register: (ns, dictionaries) => record.locale.push({ ns, dictionaries })
  },
  slots: {
    inject: (key, callback) => {
      const disposer = callback()
      record.slots.push({ key, disposer })
      return () => {}
    },
    register: (options, component) => {
      record.slots.push({ options, component })
      return () => {}
    }
  },
  shortcuts: { register: (command) => (record.shortcuts.push(command), () => {}) },
  uiWorkspace: { openSession: (id) => (record.opened = id) },
  logger: { warn: (message) => record.warned.push(message) }
}

module.apply(ctx)

check(record.locale.length === 1 && record.locale[0].ns === 'superSearch', 'the client dictionary is registered')
check(record.locale[0].dictionaries.en !== undefined && record.locale[0].dictionaries.zh !== undefined, 'the dictionary carries English and Chinese')
check(record.warned.length === 0, 'no warning during activation')

const overlay = record.slots.find((entry) => entry.options !== undefined && entry.options.name === 'shell.overlay')
const entry = record.slots.find((entry) => entry.options !== undefined && entry.options.name === 'sidebar.footer.action')
check(overlay !== undefined, 'the palette registers into shell.overlay')
check(entry !== undefined, 'the entry registers into sidebar.footer.action')
check(record.shortcuts.length === 1 && record.shortcuts[0].id === 'super-search.open', 'the shortcut is registered')

const overlayProps = overlay.options.inject()
const entryProps = entry.options.inject()
check(typeof overlayProps.onOpenSession === 'function', 'the palette receives the session opener')
check(typeof entryProps.onOpen === 'function', 'the entry receives the opener')

const { openStore } = overlayProps
check(openStore.getSnapshot().open === false, 'the palette starts closed')
const closed = overlay.component({ t: (key) => key, ...overlayProps })
check(closed === null, 'a closed palette renders nothing')

entryProps.onOpen()
check(openStore.getSnapshot().open === true, 'the entry opens the palette')
const firstOpen = openStore.getSnapshot().generation
check(firstOpen === 1, 'opening advances the generation once')

entryProps.onOpen()
check(openStore.getSnapshot().generation === firstOpen, 're-opening while open keeps the same run')

const opened = overlay.component({ t: (key) => key, ...overlayProps })
check(opened !== null && opened.portal !== undefined, 'an open palette portals its card')
const body = opened.portal.children[0]
check(body !== undefined && body.type.name === 'PaletteBody', 'the card is the palette body')
check(body.props.key === firstOpen, 'the body is keyed by the open generation')

openStore.close()
check(openStore.getSnapshot().open === false, 'closing the palette clears the open flag')
check(overlay.component({ t: (key) => key, ...overlayProps }) === null, 'a closed palette renders nothing again')

entryProps.onOpen()
const secondOpen = openStore.getSnapshot().generation
check(secondOpen === firstOpen + 1, 'opening again advances the generation')
const reopened = overlay.component({ t: (key) => key, ...overlayProps })
check(reopened.portal.children[0].props.key === secondOpen, 'the reopened body has a new key, so its state is new')

overlayProps.onOpenSession('session-1')
check(record.opened === 'session-1', 'a hit opens its session')

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
