# Sound effects — Design

**Date:** 2026-09-30
**Status:** Approved
**Issue:** #67

## 1. Goal

The game is silent. A player asked for small sounds, and a shot that lands or a ship that goes down should be heard as well as seen.

Decisions taken with the owner:

- Sounds are **synthesised in the browser** with the Web Audio API. There are no audio files: nothing to license, nothing to download, and the CSP stays as it is.
- Sound is **on by default**, with a toggle in the top bar that is remembered.

Non-goals: background music, a volume slider, different sounds for the player's and the opponent's shots, sounds on the terms page.

## 2. The cues

Six cues, each under 1.5 seconds:

| Cue | When | Character |
|---|---|---|
| `place` | A ship is placed, moved or turned; Random; sound switched on | A short wooden tick |
| `miss` | A shot lands on water, by either player | A splash: filtered noise and a falling plop |
| `hit` | A shot hits a ship | A thud: low noise burst and a falling square tone |
| `sunk` | A shot sinks a ship | A longer rumble under a tone falling to the bottom |
| `victory` | The game ends and the player won | Four rising notes |
| `defeat` | The game ends and the player lost | Four falling notes |

- The three shot cues carry the names of the `shot` message's `result`, so the message picks its cue directly.
- `victory` and `defeat` start 0.6 s late, after the cue of the shot that ended the game.
- The end cues play only on the change from `playing` to `finished`. A page that reloads into a finished game stays quiet.

**Sound never carries information alone.** Every event keeps its mark on the board, its line in the log and its text for assistive technology.

## 3. Components

### 3.1 `public/js/sound.js` (new)

- `CUES`: a `Map` from cue name to its voices. A voice is data: an oscillator (`wave`, falling or rising from `from` to `to` Hz) or filtered noise (`noise` filter type, cutoff from `from` to `to` Hz), with a start offset `at`, a length `for` and a peak `gain` that decays to silence.
- `schedule(context, voices)`: builds the Web Audio nodes of one cue on a context, starting now.
- `SoundBoard`: what the game talks to.
  - `new SoundBoard({ muted, createContext })`. `createContext` defaults to `() => new AudioContext()` and is injected in tests.
  - `muted`: a plain boolean the owner of the board sets.
  - `play(name)`: plays a cue. It never throws and never blocks the game:
    - muted, or an unknown name: nothing happens;
    - the audio context is created on the first cue played, not at page load;
    - a browser without Web Audio stays silent, and creation is not retried;
    - browsers keep a context suspended until the page is used. A cue asked for while suspended asks the context to resume and plays only if that happens within 500 ms. A later resume must not release a burst of old cues.

### 3.2 The preference

`session.muted` in `session.js` keeps the choice in `localStorage` under `naval.muted`, with the same tolerance of blocked storage as the nickname and the flag. The board also holds the flag in memory, so the toggle works on a page whose storage is blocked.

### 3.3 Wiring in `app.js`

- A `shot` message plays the cue named by its `result`.
- A state that moves from `playing` to `finished` plays `victory` or `defeat`.
- `PlacementView` takes an `onPlace` callback, called after a ship is placed, moved or turned and after Random.
- The toggle flips `sound.muted`, stores it, updates `aria-pressed`, and plays `place` so that switching sound on is heard.

### 3.4 The toggle

A second button in the top bar of the game page, before the theme toggle: label "Sound", `aria-pressed="true"` while sound is on.

- It shares the theme toggle's look. The shared rules move from `.theme-toggle` to `.topbar-toggle`.
- The icon is a flat speaker. On: two bars beside it. Off: a cross beside it. The state is a shape, not a colour.
- Under 420px the label is visually hidden, as the theme label is; the accessible name stays.

### 3.5 Server and protocol

Unchanged.

## 4. Security

No exposed surface changes. Web Audio synthesis makes no request, so the CSP needs no `media-src` and is not touched. The cue name taken from a server message is looked up in a `Map`, so an unexpected value plays nothing. The stored preference is a single flag that is only compared, never rendered.

## 5. Testing

- **Unit (`node --test`), with a fake audio context:**
  - a cue starts one source per voice, none in the past;
  - muted and unknown cues create no context and start nothing;
  - a suspended context is asked to resume; the cue plays when that is quick and is dropped when it is late;
  - a browser without Web Audio does not throw and is asked only once;
  - every cue is well formed: positive lengths, gains in (0, 1], finished within 1.5 s.
- **E2E:**
  - the toggle is on by default, flips, and is remembered across a reload;
  - placing a ship and a shot (for both players) start audio sources; nothing starts while muted; no console or CSP errors;
  - every cue rendered through an `OfflineAudioContext` is audible and does not clip (peak between 0.1 and 0.95).
- What no test covers: how the cues sound. That is judged by ear.
