const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function setup(getUserMedia) {
  const messages = [],
    timers = new Map();
  let timer = 0;
  const tracks = [
    {
      stops: 0,
      stop() {
        this.stops++;
      },
    },
  ];
  const stream = {
    active: true,
    getTracks: () => tracks,
    getAudioTracks: () => tracks,
  };
  const box = {
    window: { WebAssembly: {}, Worker: {}, AudioWorkletNode: {} },
    navigator: {
      mediaDevices: {
        getUserMedia:
          getUserMedia ||
          (async (constraints) => {
            box.constraints = constraints;
            return stream;
          }),
      },
    },
    setTimeout(fn) {
      timers.set(++timer, fn);
      return timer;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    Worker: class {
      postMessage(data) {
        messages.push(data);
      }
      terminate() {
        this.terminated = true;
      }
    },
    AudioWorkletNode: class {
      port = { postMessage: (data) => messages.push(data) };
      connect() {}
      disconnect() {
        this.disconnected = true;
      }
    },
  };
  vm.createContext(box);
  vm.runInContext(fs.readFileSync("dist/keyer.js", "utf8"), box);
  const keyer = new box.window.LocalKeyer();
  const context = {
    sampleRate: 48000,
    audioWorklet: { async addModule() {} },
    async resume() {},
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    },
  };
  return { box, keyer, messages, timers, stream, tracks, context };
}
async function ready(s) {
  const loading = s.keyer.load();
  s.keyer.worker.onmessage({ data: { type: "ready" } });
  await loading;
  await s.keyer.openMicrophone(s.context);
}
const callbacks = () => {
  const results = [],
    partials = [],
    errors = [],
    empty = [];
  return {
    results,
    partials,
    errors,
    empty,
    options: {
      onResult: (x) => results.push(x),
      onPartial: (x) => partials.push(x),
      onEmpty: () => empty.push(true),
      onError: (x) => errors.push(x),
    },
  };
};
test("keyer disables speech processing, flushes final samples, and submits once", async () => {
  const s = setup();
  await ready(s);
  assert.equal(s.box.constraints.audio.noiseSuppression, false);
  assert.equal(s.box.constraints.audio.echoCancellation, false);
  assert.equal(s.box.constraints.audio.autoGainControl, false);
  const c = callbacks();
  s.keyer.listen(c.options);
  const id = s.keyer.captureId;
  s.keyer.worker.onmessage({ data: { type: "partial", id, text: "K1A" } });
  assert.deepEqual(c.partials, ["K1A"]);
  assert.deepEqual(c.results, []);
  s.keyer.finish();
  s.keyer.finish();
  assert.equal(s.messages.filter((x) => x.flush === id).length, 1);
  const samples = new Float32Array([0.1, 0.2]);
  s.keyer.node.port.onmessage({ data: { id, samples } });
  s.keyer.node.port.onmessage({ data: { flushed: id } });
  assert.equal(s.messages.at(-2).type, "samples");
  assert.equal(s.messages.at(-1).type, "finish");
  const result = { data: { type: "result", id, text: "K1ABC" } };
  s.keyer.worker.onmessage(result);
  s.keyer.worker.onmessage(result);
  assert.deepEqual(c.results, ["K1ABC"]);
  assert.equal(s.timers.size, 0);
  s.keyer.closeMicrophone();
  assert.equal(s.tracks[0].stops, 1);
});
test("repeat invalidates late results and empty audio never scores", async () => {
  const s = setup();
  await ready(s);
  const old = callbacks();
  s.keyer.listen(old.options);
  const oldId = s.keyer.captureId;
  const fresh = callbacks();
  s.keyer.listen(fresh.options);
  s.keyer.worker.onmessage({
    data: { type: "result", id: oldId, text: "K1ABC" },
  });
  assert.deepEqual(old.results, []);
  assert.deepEqual(fresh.results, []);
  s.keyer.worker.onmessage({
    data: { type: "result", id: s.keyer.captureId, text: "  " },
  });
  assert.deepEqual(fresh.results, []);
  assert.equal(fresh.empty.length, 1);
});
test("microphone permission granted after cancellation releases the late stream", async () => {
  let grant;
  const s = setup(
    () =>
      new Promise((resolve) => {
        grant = resolve;
      }),
  );
  const pending = s.keyer.openMicrophone(s.context);
  s.keyer.closeMicrophone();
  grant(s.stream);
  assert.equal(await pending, false);
  assert.equal(s.tracks[0].stops, 1);
  assert.equal(s.keyer.stream, null);
});
test("runtime failure releases the worker and allows a fresh load", async () => {
  const s = setup();
  await ready(s);
  const c = callbacks();
  s.keyer.listen(c.options);
  const worker = s.keyer.worker;
  worker.onerror();
  assert.equal(worker.terminated, true);
  assert.equal(c.errors.length, 1);
  assert.equal(s.keyer.loading, null);
  const pending = s.keyer.load();
  assert.notEqual(s.keyer.worker, worker);
  s.keyer.worker.onmessage({ data: { type: "ready" } });
  await pending;
});
test("worklet flush sends the last incomplete audio buffer before the completion marker", () => {
  let Processor;
  const messages = [];
  const box = {
    AudioWorkletProcessor: class {
      port = { postMessage: (data) => messages.push(data) };
    },
    registerProcessor(_, value) {
      Processor = value;
    },
  };
  vm.createContext(box);
  vm.runInContext(fs.readFileSync("dist/mic-worklet.js", "utf8"), box);
  const node = new Processor();
  node.port.onmessage({ data: { active: 12 } });
  node.process([[new Float32Array([0.25, 0.5])]], []);
  node.port.onmessage({ data: { flush: 12 } });
  assert.equal(messages[0].id, 12);
  assert.deepEqual(Array.from(messages[0].samples), [0.25, 0.5]);
  assert.equal(messages[1].flushed, 12);
  node.process([[new Float32Array(2048)]], []);
  assert.equal(messages.length, 2);
});

test("matching partial copy scores immediately and cancels stale worker messages", async () => {
  const s = setup();
  await ready(s);
  const c = callbacks();
  s.keyer.listen({ ...c.options, isComplete: (text) => text === "N0AA" });
  const id = s.keyer.captureId;
  s.keyer.worker.onmessage({ data: { type: "partial", id, text: "N0A" } });
  assert.equal(c.results.length, 0);
  s.keyer.worker.onmessage({ data: { type: "partial", id, text: "N0AA" } });
  s.keyer.worker.onmessage({ data: { type: "result", id, text: "N0AA" } });
  assert.deepEqual(c.results, ["N0AA"]);
  assert.equal(s.timers.size, 0);
});
test("silence automatically flushes an incorrect or incomplete copy; tones extend the window", async () => {
  const s = setup();
  await ready(s);
  const c = callbacks();
  s.keyer.listen({ ...c.options, isComplete: () => false });
  const id = s.keyer.captureId;
  s.keyer.worker.onmessage({ data: { type: "partial", id, text: "N0A" } });
  const first = s.keyer.silenceTimeout;
  const samples = Float32Array.from(
    { length: 2048 },
    (_, i) => 0.1 * Math.sin((2 * Math.PI * 600 * i) / 48000),
  );
  s.keyer.node.port.onmessage({ data: { id, samples } });
  assert.equal(s.timers.has(first), false);
  s.timers.get(s.keyer.silenceTimeout)();
  assert.equal(s.messages.at(-1).flush, id);
  s.keyer.node.port.onmessage({ data: { flushed: id } });
  assert.equal(s.messages.at(-1).type, "finish");
  s.keyer.worker.onmessage({ data: { type: "result", id, text: "N0AB" } });
  assert.deepEqual(c.results, ["N0AB"]);
});
test("tone detection accepts the supported keyer band and rejects silence and broadband noise", () => {
  const { box } = setup();
  const Keyer = box.window.LocalKeyer;
  for (const rate of [44100, 48000]) {
    for (const hz of [400, 512, 600, 733, 900, 1200]) {
      const samples = Float32Array.from(
        { length: 2048 },
        (_, i) => 0.01 * Math.sin((2 * Math.PI * hz * i) / rate),
      );
      assert.equal(
        Keyer.hasTone(samples, rate),
        true,
        `${rate}Hz sampling, ${hz}Hz tone`,
      );
    }
    assert.equal(Keyer.hasTone(new Float32Array(2048), rate), false);
    let seed = 45;
    const noise = Float32Array.from({ length: 2048 }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return (seed / 2 ** 32 - 0.5) * 0.1;
    });
    assert.equal(Keyer.hasTone(noise, rate), false);
  }
});

test("finish arriving during streaming inference waits for a final decode", async () => {
  const messages = [];
  let release,
    final = 0;
  const box = {
    importScripts() {},
    self: { location: { href: "http://localhost/deepcw-worker.js" } },
    URL,
    ort: {
      env: { wasm: {} },
      InferenceSession: {
        async create() {
          return {};
        },
      },
    },
    async fetch() {
      return {
        ok: true,
        async json() {
          return { sample_rate: 10 };
        },
      };
    },
    resampleLinear: (audio) => audio,
    Decoder: class {
      transcript = "";
      pending = "K1";
      step() {
        return new Promise((resolve) => {
          release = resolve;
        });
      }
      async finalize() {
        final++;
        this.transcript = "K1ABC";
      }
    },
    postMessage: (message) => messages.push(message),
  };
  vm.createContext(box);
  vm.runInContext(fs.readFileSync("dist/deepcw-worker.js", "utf8"), box);
  await box.self.onmessage({ data: { type: "load" } });
  await box.self.onmessage({ data: { type: "start", id: 1, rate: 10 } });
  await box.self.onmessage({
    data: { type: "samples", id: 1, samples: new Float32Array(25) },
  });
  await box.self.onmessage({ data: { type: "finish", id: 1 } });
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(final, 1);
  assert.equal(messages.at(-1).type, "result");
  assert.equal(messages.at(-1).text, "K1ABC");
});
