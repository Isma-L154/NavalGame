import assert from "node:assert/strict";
import { test } from "node:test";
import { CUES, SoundBoard } from "../../public/js/sound.js";

class FakeParam {
  setValueAtTime() {}

  exponentialRampToValueAtTime() {}
}

class FakeNode {
  frequency = new FakeParam();
  gain = new FakeParam();
  target = null;

  connect(target) {
    this.target = target;
  }

  disconnect() {
    this.target = null;
  }
}

/** Records when sources start and stop; `resumed` is the promise `resume()` returns. */
class FakeContext {
  currentTime = 5;
  sampleRate = 8;
  destination = new FakeNode();
  started = [];
  stopped = [];
  gains = [];
  resumes = 0;

  constructor({ state = "running", resumed = Promise.resolve() } = {}) {
    this.state = state;
    this.resumed = resumed;
  }

  #source() {
    const node = new FakeNode();
    node.start = (time) => this.started.push(time);
    node.stop = (time) => this.stopped.push(time);
    return node;
  }

  createOscillator() {
    return this.#source();
  }

  createBufferSource() {
    return this.#source();
  }

  createBiquadFilter() {
    return new FakeNode();
  }

  createGain() {
    const node = new FakeNode();
    this.gains.push(node);
    return node;
  }

  /** The gain nodes whose output reaches the speakers. */
  get audible() {
    const reaches = (node) => node === this.destination || (node !== null && reaches(node.target));
    return this.gains.filter(reaches);
  }

  createBuffer(_channels, length) {
    return { getChannelData: () => new Float32Array(length) };
  }

  resume() {
    this.resumes += 1;
    return this.resumed;
  }
}

/** A board on a fake context, with the number of contexts it asked for. */
function boardOn(context, { muted = false } = {}) {
  const created = { count: 0 };
  const board = new SoundBoard({
    muted,
    createContext: () => {
      created.count += 1;
      return context;
    },
  });
  return { board, created };
}

const settled = () => new Promise((resolve) => setImmediate(resolve));

test("a cue starts one source per voice, none in the past", () => {
  for (const [name, voices] of CUES) {
    const context = new FakeContext();
    boardOn(context).board.play(name);
    assert.equal(context.started.length, voices.length, name);
    assert.ok(context.started.every((time) => time >= context.currentTime), name);
    assert.ok(context.stopped.every((time, i) => time > context.started[i]), name);
  }
});

test("a muted board creates no audio context", () => {
  const context = new FakeContext();
  const { board, created } = boardOn(context, { muted: true });
  board.play("hit");
  assert.equal(created.count, 0);
  board.muted = false;
  board.play("hit");
  assert.equal(context.started.length, CUES.get("hit").length);
});

test("switching sound off silences the cues already playing, and later ones play again", () => {
  const context = new FakeContext();
  const { board } = boardOn(context);
  board.play("sunk");
  assert.ok(context.audible.length > 0);
  board.muted = true;
  assert.equal(context.audible.length, 0);
  board.muted = false;
  board.play("place");
  // The place cue's one voice and the output it goes through.
  assert.equal(context.audible.length, CUES.get("place").length + 1);
});

test("an unknown cue creates no audio context", () => {
  const { board, created } = boardOn(new FakeContext());
  board.play("constructor");
  board.play(undefined);
  assert.equal(created.count, 0);
});

test("the audio context is created once, on the first cue", () => {
  const { board, created } = boardOn(new FakeContext());
  assert.equal(created.count, 0);
  board.play("place");
  board.play("place");
  assert.equal(created.count, 1);
});

test("a suspended context is resumed, and the cue plays when that is quick", async () => {
  const context = new FakeContext({ state: "suspended" });
  boardOn(context).board.play("miss");
  assert.equal(context.resumes, 1);
  assert.equal(context.started.length, 0);
  await settled();
  assert.equal(context.started.length, CUES.get("miss").length);
});

test("a cue that waited too long for the context is dropped", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  let resume;
  const context = new FakeContext({
    state: "suspended",
    resumed: new Promise((resolve) => {
      resume = resolve;
    }),
  });
  boardOn(context).board.play("miss");
  t.mock.timers.tick(501);
  resume();
  await settled();
  assert.equal(context.started.length, 0);
});

test("a cue waiting for the context is dropped when sound is switched off meanwhile", async () => {
  const context = new FakeContext({ state: "suspended" });
  const { board } = boardOn(context);
  board.play("miss");
  board.muted = true;
  await settled();
  assert.equal(context.started.length, 0);
});

test("a refused resume is ignored", async () => {
  const context = new FakeContext({ state: "suspended", resumed: Promise.reject(new Error("not allowed")) });
  boardOn(context).board.play("miss");
  await settled();
  assert.equal(context.started.length, 0);
});

test("waking the board from a gesture starts a suspended context, so later cues play at once", () => {
  const context = new FakeContext({ state: "suspended" });
  const { board } = boardOn(context);
  board.wake();
  assert.equal(context.resumes, 1);
  assert.equal(context.started.length, 0);
  context.state = "running";
  board.wake();
  assert.equal(context.resumes, 1);
  board.play("hit");
  assert.equal(context.started.length, CUES.get("hit").length);
});

test("waking a muted board creates no audio context", () => {
  const { board, created } = boardOn(new FakeContext({ state: "suspended" }), { muted: true });
  board.wake();
  assert.equal(created.count, 0);
});

test("waking ignores a refused resume and a browser without Web Audio", async () => {
  const refused = new FakeContext({ state: "suspended", resumed: Promise.reject(new Error("not allowed")) });
  boardOn(refused).board.wake();
  await settled();
  new SoundBoard({
    createContext: () => {
      throw new ReferenceError("AudioContext is not defined");
    },
  }).wake();
});

test("a browser without Web Audio stays silent and is asked once", () => {
  let asked = 0;
  const board = new SoundBoard({
    createContext: () => {
      asked += 1;
      throw new ReferenceError("AudioContext is not defined");
    },
  });
  board.play("hit");
  board.play("hit");
  assert.equal(asked, 1);
});

test("every cue is well formed", () => {
  assert.deepEqual([...CUES.keys()], ["place", "miss", "hit", "sunk", "victory", "defeat"]);
  for (const [name, voices] of CUES) {
    assert.ok(voices.length > 0, name);
    for (const voice of voices) {
      assert.ok(Boolean(voice.wave) !== Boolean(voice.noise), `${name}: a tone or noise`);
      // Exponential sweeps and fades cannot start from, or reach, zero.
      assert.ok(voice.from > 0 && voice.to > 0, name);
      assert.ok(voice.gain > 0 && voice.gain <= 1, name);
      assert.ok(voice.at >= 0 && voice.lasts > 0, name);
      assert.ok(voice.at + voice.lasts <= 1.5, name);
      // The noise buffer holds one second.
      if (voice.noise) assert.ok(voice.lasts <= 1, name);
    }
  }
});
