# Loop Console — an Off-Guard module

A GM console for looping adventures. It supplements the initiative tracker and
deliberately does not duplicate it: no combatants, no HP, no turn order. It
tracks the one thing a looping adventure needs and a normal tracker cannot do,
which is **what survives a reset and what does not**.

Built for *Nine Minutes to the Toast*, but the adventure is pure data — swap
`nine-minutes.data.js` for another definition and the console runs that instead.

## Why this exists

In a looping adventure the bookkeeping that actually hurts is the persist/reset
split. The party remembers; the world does not. Every loop you have to remember
that they *know* about the fake wine but the decanter is full of fig wine again,
that they got the Duke to 6 influence last time but he is back to 0 and has never
met them, and that the ooze they killed in the cold room is the one thing that
stayed dead.

The console models that split as a first-class concept:

| Persists across a reset | Resets every loop |
|---|---|
| `known` on each fault | `fixed` on each fault |
| `sticky` (permanent solves) | influence `points` |
| influence `highWater` | the slot clock |
| influence `discovered` | |
| the per-loop slot log (kept as history) | |

`sticky` is the interesting one. Killing the Carnivorous Blob permanently stops
the aspic re-forming, so marking that fault solved-permanently re-applies `fixed`
automatically at the top of every subsequent loop.

## Files

```
src/
  loop-console.js        the custom element + storage adapters
  loop-console.css       component styles, scoped under <loop-console>
  nine-minutes.data.js   the adventure definition (pure data)
  mount.js               demo mount point
  demo.html              standalone integration example
build-artifact.js        inlines the above into one hosted page
smoke.mjs                35 Playwright assertions
```

## Integration

```html
<link rel="stylesheet" href="/modules/loop-console.css">
<script type="module" src="/modules/mount.js"></script>
<loop-console id="console"></loop-console>
```

```js
import { ADVENTURE } from './nine-minutes.data.js';
import { localAdapter } from './loop-console.js';

const node = document.getElementById('console');
node.adventure = ADVENTURE;
node.storage = localAdapter('off-guard:loop:' + ADVENTURE.id);
```

### Matching the Off-Guard build brief

- **Vanilla ES modules.** No framework, no build step, no bundler.
- **No external CDN, no runtime network calls.** Jost is expected from the host
  application's own `@font-face`; the stack degrades to `system-ui` if absent.
- **CSP-safe.** No inline `<style>`, no inline `<script>`, no `style` attributes
  anywhere — a policy without `unsafe-inline` passes unmodified. There is a
  smoke assertion for this so it cannot regress.
- **Light DOM, not shadow DOM.** Deliberate. Encapsulation would be a liability
  here: every token is `var(--og-*, fallback)`, so the module adopts the app's
  palette when mounted inside it and falls back to `#667EEA` / `#764BA2` /
  `#1A1033` when standing alone. Shadow DOM would have blocked that inheritance
  for the sake of isolation nobody needs.
- **Dark by default with a light toggle**, honoring `prefers-color-scheme` and
  `[data-theme]` in all three states (explicit dark, explicit light, unstamped).
- **SVG icons, no emoji.**
- **Destructive actions are undoable.** Burning the room is the only destructive
  action and it has one level of undo, keyboard-bound to `U`.
- **Accessibility.** Semantic HTML, full keyboard operation, visible focus,
  `aria-pressed` on every toggle, an `aria-live` region announcing slot and loop
  changes, `prefers-reduced-motion` respected, and an assertion that every
  button has an accessible name.

### Swapping storage

`localAdapter(key)` and `memoryAdapter()` ship with the module. The interface is
two methods:

```js
{ load() -> state | null,
  save(state) -> void }
```

Point it at the campaign API and loop state survives a reload on another device.
The component also emits `loop-console:change`, `loop-console:reset` and
`loop-console:perfect`, all bubbling and composed, which is the natural seam for
pushing loop state to the shared table screen over SSE.

## Keyboard

| Key | Action |
|---|---|
| `←` `→` | previous / next slot |
| `Space` | next slot |
| `R` | burn the room (reset the loop) |
| `U` | undo the last reset |

## Tests

```
node build-artifact.js
node smoke.mjs
```

35 assertions in headless Chromium covering structure, the clock, the
persist/reset split, undo, sticky solves, both themes, host token inheritance,
accessible naming, CSP-hostile patterns (nested buttons, inline styles), and
horizontal overflow at 390px.

Two bugs these caught that review did not:

1. `display: flex` on the perfect-run banner silently overrode the `hidden`
   attribute, so it showed from loop 1. Fixed with a scoped
   `[hidden] { display: none !important }`. The original assertion only checked
   that the banner *appeared*, which a permanently visible banner also passes —
   the test now asserts it starts hidden.
2. The fault pills were nested inside the fault expander button. Nested
   interactive controls are invalid HTML and break keyboard navigation.

## Known gaps

- The slot log keeps per-loop history in state but there is no UI yet for
  reading back an earlier loop. The data is there; the view is not.
- No print stylesheet.
- `structuredClone` is used for undo, so this needs a 2022+ browser. Fine for a
  self-hosted GM tool, worth knowing.
