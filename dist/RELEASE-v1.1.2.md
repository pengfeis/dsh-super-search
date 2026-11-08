# v1.1.2 · fix: the workspace scope bar was clipped

The scope bar in the search palette was squeezed by the result list, so the
"all workspaces" chip was cut in half.

## Cause

The card is a flex column with a maximum height. Every child was free to
shrink, and the result list — whose content is far taller than the card — took
almost all of the space, collapsing the scope bar until its chip was clipped by
the card's own overflow.

## Fix

Only the result list may shrink now: it takes the remaining space
(`flex: 1 1 auto`), may shrink below its content (`min-height: 0`), and scrolls.
The header, the meta row, the scope bar, and the footer keep their height
(`flex-shrink: 0`). The scope bar scrolls sideways when there are more
workspaces than fit, and the card may grow a little taller.

The client test now asserts that nothing but the result list may shrink, so
this cannot come back silently.

## Install

```bash
plugin_manager install_bundle target=git+https://github.com/pengfeis/dsh-super-search.git#v1.1.2
```
