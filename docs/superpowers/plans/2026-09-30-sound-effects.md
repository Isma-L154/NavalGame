# Sound effects (#67) Implementation Plan

> Executed task by task in a single session (this project uses no parallel agents). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six short synthesised cues (place, miss, hit, sunk, victory, defeat) with a remembered Sound toggle in the top bar.

**Architecture:**
- `sound.js` holds the cues as data, `schedule(context, voices)` to build them on a Web Audio context, and `SoundBoard`, which the game calls with `play(name)`.
- `session.js` remembers the mute choice; `app.js` plays cues on `shot` messages, on the end of a game and on placement, and wires the toggle.
- The server and the protocol do not change.

**Tech Stack:** vanilla ES modules, Web Audio API, Node's built-in test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-30-sound-effects-design.md`

## Global Constraints

- No audio files, no new dependency, CSP unchanged.
- `play` never throws and never blocks the game.
- Cue names: `place`, `miss`, `hit`, `sunk`, `victory`, `defeat`. The three shot cues are the `result` values of the `shot` message.
- A cue is dropped when the audio context takes more than 500 ms to resume.
- Every cue ends within 1.5 s; noise voices last at most 1 s (the length of the noise buffer).
- Storage key `naval.muted`, value `"1"` when muted, absent otherwise. Sound is on by default.
- Toggle: `id="sound-toggle"`, accessible name "Sound", `aria-pressed="true"` while sound is on.
- The shared toggle rules are renamed from `.theme-toggle*` to `.topbar-toggle*`; the ids stay.
- Commits authored as `ismaleonsaenz@gmail.com`; the PR says `Closes #67`.

## File Structure

| File | Responsibility |
|---|---|
| `public/js/sound.js` (new) | `CUES`, `schedule(context, voices)`, `SoundBoard`. |
| `tests/frontend/sound.test.mjs` (new) | Unit tests with a fake audio context. |
| `public/js/session.js` | `session.muted`. |
| `public/js/placement.js` | `onPlace` callback after a ship is placed, moved, turned, and after Random. |
| `public/js/app.js` | Creates the board, plays the cues, wires the toggle. |
| `public/index.html` | The Sound button; `sound.js` module preload. |
| `public/terms.html` | Class rename only. |
| `public/styles.css` | `.topbar-toggle*` rename; the speaker icon states. |
| `e2e/sound.spec.js` (new) | Toggle, wiring, rendered levels. |
| `CLAUDE.md` | One line on sound in the UI/UX section. |

---

### Task 1: `sound.js`

**Files:**
- Create: `tests/frontend/sound.test.mjs`, `public/js/sound.js`

**Interfaces:**
- Produces:
  - `CUES: Map<string, Voice[]>`, where a voice is `{ wave | noise, from, to, at, lasts, gain }`;
  - `schedule(context, voices)`;
  - `new SoundBoard({ muted = false, createContext = () => new AudioContext() })`, with the boolean field `muted` and `play(name)`.

- [ ] **Step 1: Write the failing tests** in `tests/frontend/sound.test.mjs`, against a `FakeContext` that records `start` and `stop` times, counts `resume()` calls and returns a promise the test controls:
  - a cue starts one source per voice, none in the past, each stopped after it starts;
  - a muted board creates no audio context;
  - an unknown cue creates no audio context;
  - the audio context is created once, on the first cue;
  - a suspended context is resumed and the cue plays when that is quick;
  - a cue that waited more than 500 ms for the context is dropped (mocked `Date`);
  - a refused resume is ignored;
  - a browser without Web Audio stays silent and is asked once;
  - every cue is well formed.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test "tests/frontend/*.test.mjs"`
Expected: the sound tests fail, `Cannot find module ... public/js/sound.js`.

- [ ] **Step 3: Implement `public/js/sound.js`**

```js
const STALE_MS = 500;
const SILENCE = 0.001;

/** Notes played one after the other, after the cue of the shot that ended the game. */
const melody = (frequencies) =>
  frequencies.map((hz, i) => ({
    wave: "triangle",
    from: hz,
    to: hz,
    at: 0.6 + i * 0.13,
    lasts: i === frequencies.length - 1 ? 0.5 : 0.13,
    gain: 0.3,
  }));

/**
 * Each cue is a list of voices: an oscillator (`wave`) or filtered noise (`noise`, the filter
 * type) sweeping from `from` to `to` Hz. It starts `at` seconds in, at its peak `gain`, and
 * fades to silence over `lasts` seconds.
 */
export const CUES = new Map(Object.entries({
  place: [{ wave: "triangle", from: 520, to: 260, at: 0, lasts: 0.07, gain: 0.35 }],
  miss: [
    { noise: "bandpass", from: 1800, to: 400, at: 0, lasts: 0.35, gain: 0.9 },
    { wave: "sine", from: 320, to: 110, at: 0, lasts: 0.18, gain: 0.25 },
  ],
  hit: [
    { noise: "lowpass", from: 3000, to: 300, at: 0, lasts: 0.3, gain: 0.8 },
    { wave: "square", from: 170, to: 55, at: 0, lasts: 0.25, gain: 0.25 },
  ],
  sunk: [
    { noise: "lowpass", from: 3000, to: 200, at: 0, lasts: 0.9, gain: 0.7 },
    { wave: "sawtooth", from: 440, to: 55, at: 0, lasts: 0.9, gain: 0.2 },
  ],
  victory: melody([523, 659, 784, 1047]),
  defeat: melody([392, 330, 262, 196]),
}));
```

followed by `noiseBuffer(context)` (one second of white noise, cached per context in a `WeakMap`), `schedule(context, voices)` and `SoundBoard` as the spec describes them. The gains above are a starting point: Task 2's rendered-level test measures each cue's peak, and the gains are adjusted until every cue sits between 0.1 and 0.95.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "tests/frontend/*.test.mjs"`
Expected: all pass, the 7 fleet tests included.

- [ ] **Step 5: Commit**

```bash
git add public/js/sound.js tests/frontend/sound.test.mjs docs/superpowers
git commit -m "feat: synthesised sound cues and the board that plays them"
```

---

### Task 2: The game plays the cues, and the Sound toggle

**Files:**
- Create: `e2e/sound.spec.js`
- Modify: `public/js/session.js`, `public/js/placement.js`, `public/js/app.js`, `public/index.html`, `public/terms.html`, `public/styles.css`, `CLAUDE.md`

**Interfaces:**
- Consumes: `CUES`, `schedule`, `SoundBoard` from Task 1.
- Produces: `session.muted` (boolean get/set); `PlacementView({ onReady, onChooseFlag, onPlace })`.

- [ ] **Step 1: Write the failing E2E tests** in `e2e/sound.spec.js`:
  - "sound is on by default, and switching it off is remembered": the Sound button is pressed; a click releases it; after a reload it is still released; a click presses it again.
  - "placing ships and shots are heard, unless sound is off": an init script counts `start()` calls on `AudioScheduledSourceNode` and `AudioBufferSourceNode`. Placing a ship raises the count; with sound off, placing another does not; switching sound on raises it; a shot raises it for the shooter and for the target; no console or CSP errors.
  - "every cue is audible and does not clip" (desktop only): each cue is rendered with `schedule` on an `OfflineAudioContext(1, 88200, 44100)`; its peak is above 0.1 and below 0.95.

- [ ] **Step 2: Run them to verify they fail**

Run (dev server running): `npx playwright test e2e/sound.spec.js --project=desktop`
Expected: the first two fail (no Sound button); the third passes or shows which gains to adjust.

- [ ] **Step 3: Implement**

- `session.js`: `muted` getter (`read(localStorage, "naval.muted") === "1"`) and setter (`"1"` or removal).
- `placement.js`: store `onPlace`; call it after a successful `#place`, a successful turn in `#rotate`, and `#randomize`.
- `app.js`:
  - `const sound = new SoundBoard({ muted: session.muted });`
  - `PlacementView` gets `onPlace: () => sound.play("place")`;
  - `case "shot"`: `sound.play(message.result)` after `battle.recordShot`;
  - in `onState`: when `previous?.phase === "playing"` and `state.phase === "finished"`, play `victory` or `defeat` by `state.winner === state.seat`;
  - in `init`: the toggle click flips `sound.muted`, stores it in `session.muted`, sets `aria-pressed` and plays `place`; `aria-pressed` is set once at start;
  - in `init`: every `click` and `keydown` on the document calls `sound.wake()` (added to `SoundBoard` with its unit tests: it creates the context when sound is on and resumes it when it is not running), because browsers start audio only from a gesture and most cues answer a server message.
- `index.html`: the button before the theme toggle, and `<link rel="modulepreload" href="/js/sound.js">`:

```html
<button id="sound-toggle" class="topbar-toggle" type="button" aria-pressed="true">
  <svg class="topbar-toggle-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <path d="M2 7h4l5-4v14l-5-4H2z" fill="currentColor" />
    <path class="sound-icon-on" d="M14 7v6M17 4v12" fill="none" stroke="currentColor" stroke-width="2" />
    <path class="sound-icon-off" d="m13 7 6 6m0-6-6 6" fill="none" stroke="currentColor" stroke-width="2" />
  </svg>
  <span class="topbar-toggle-label">Sound</span>
</button>
```

- `styles.css`: rename `.theme-toggle`, `.theme-toggle-icon`, `.theme-toggle-label` to `.topbar-toggle*`; the dark-mode flip becomes `#theme-toggle[aria-pressed="true"] .topbar-toggle-icon`; add:

```css
/* The speaker shows bars while sound is on and a cross while it is off. */
#sound-toggle[aria-pressed="true"] .sound-icon-off,
#sound-toggle[aria-pressed="false"] .sound-icon-on {
  display: none;
}
```

- `styles.css`, top bar on one row at every width (it is sticky): up to 560px hide the toggle labels and use the phone-size brand; up to 380px tighten the bar's gaps and padding and shrink the brand once more. `e2e/responsive.spec.js` checks the row from 320px to 768px.
- `terms.html`: the class rename on its theme toggle.
- `CLAUDE.md`, UI/UX: sound is synthesised in `js/sound.js`, has no audio files, and never carries information alone.

- [ ] **Step 4: Run the checks**

Run: `node --test "tests/frontend/*.test.mjs"` — all pass.
Run (dev server running, nothing else using it): `npx playwright test` — every project passes.
Run: `uv run ruff check . && uv run ruff format --check . && uv run mypy src tests && uv run pytest` — clean.

- [ ] **Step 5: Commit**

```bash
git add public e2e/sound.spec.js CLAUDE.md
git commit -m "feat: the game plays sound cues, with a Sound toggle in the top bar"
```

---

## Delivery

One PR, `Closes #67`: review of the diff, CI green, squash merge, then check the toggle and the cues on `https://naval.cloudils.com` once deployed.
