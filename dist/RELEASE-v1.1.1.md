# v1.1.1 · fix: stored conversations are indexed

Searching used to reach only the sessions that happened to be live in the
running process. Every stored conversation was silently skipped.

## Cause

`ctx.sessionQuery.observeSession()` returns a lease that is disposed through
`Symbol.dispose`, not through a `dispose()` method. The index called
`observation.dispose()`, which threw on every stored session; the per-session
catch logged a warning and moved on, so a corpus of 49 sessions searched as if
it held one — the live one.

## Fix

The lease is released through `Symbol.dispose`, with the named method kept as a
fallback so a future shape cannot regress it. The index now holds every live and
stored session of every workspace.

The index test now hands the index a lease shaped exactly like the real one
(`Symbol.dispose` only) and asserts that every lease was released, so the
mistake fails loudly instead of quietly narrowing the corpus.

## Verified

- 49 sessions / 10 workspaces indexed; a search for `本体` returns 50 hits across
  those sessions instead of zero.
- All three test suites pass.

## Install

```bash
plugin_manager install_bundle target=git+https://github.com/pengfeis/dsh-super-search.git#v1.1.1
```
