const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
function setup() {
  const recognizers = [];
  const timers = new Map();
  let timerId = 0;
  const box = {
    window: { WebAssembly: {}, Worker: {}, AudioWorkletNode: function () {} },
    navigator: { mediaDevices: { getUserMedia() {} } },
    setTimeout(fn) {
      timers.set(++timerId, fn);
      return timerId;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    console,
  };
  vm.createContext(box);
  vm.runInContext(
    fs.readFileSync("dist/speech.js", "utf8") +
      ";this.grammar=VOICE_VOCABULARY;",
    box,
  );
  const voice = new box.window.LocalVoice(() => {});
  voice.model = {
    ready: true,
    KaldiRecognizer: class {
      constructor(rate, grammar) {
        this.rate = rate;
        this.grammar = JSON.parse(grammar);
        this.listeners = {};
        recognizers.push(this);
      }
      on(e, fn) {
        this.listeners[e] = fn;
      }
      remove() {
        this.removed = true;
      }
      retrieveFinalResult() {
        this.flushed = true;
      }
    },
  };
  voice.stream = { active: true };
  voice.context = { sampleRate: 48000 };
  voice.node = { port: { postMessage() {} } };
  return { voice, recognizers, box, timers };
}
test("grammar is fixed and covers letters, digits and phonetic words", () => {
  const { voice, recognizers } = setup();
  voice.listen({ onResult() {}, onPartial() {}, onEmpty() {}, onError() {} });
  const grammar = recognizers[0].grammar;
  for (const word of [
    "a",
    "z",
    "zero",
    "nine",
    "kilo",
    "alpha",
    "nancy",
    "november",
    "sierra",
    "sugar",
    "repeat",
    "x ray",
    "double you",
    "[unk]",
  ])
    assert(grammar.includes(word));
  assert(!grammar.some((word) => /\d/.test(word)));
});
test("final result submits once and releases the recognizer", () => {
  const { voice, recognizers, timers } = setup();
  let copies = [];
  voice.listen({
    onResult: (t) => copies.push(t),
    onPartial() {},
    onEmpty() {},
    onError() {},
  });
  const r = recognizers[0];
  r.listeners.result({ result: { text: "kilo one alpha bravo" } });
  timers.get(voice.settleTimeout)();
  r.listeners.result({ result: { text: "kilo one alpha bravo" } });
  assert.deepEqual(copies, ["kilo one alpha bravo"]);
  assert(r.removed);
  assert.equal(voice.recognizer, null);
});
test("replay cancels stale recognition events", () => {
  const { voice, recognizers, timers } = setup();
  let count = 0;
  const callbacks = {
    onResult() {
      count++;
    },
    onPartial() {
      count++;
    },
    onEmpty() {
      count++;
    },
    onError() {
      count++;
    },
  };
  voice.listen(callbacks);
  voice.stop();
  recognizers[0].listeners.result({ result: { text: "one" } });
  recognizers[0].listeners.partialresult({ result: { partial: "one" } });
  assert.equal(count, 0);
  voice.listen(callbacks);
  recognizers[1].listeners.result({ result: { text: "two" } });
  timers.get(voice.settleTimeout)();
  assert.equal(count, 1);
});
for (const event of ["partialresult", "result"]) {
  for (const deferResult of [false, true]) {
    test(`repeat immediately replays on ${event}, deferred=${deferResult}`, () => {
      const { voice, recognizers, timers } = setup();
      let replays = 0;
      const unexpected = () => assert.fail("Replay must not submit an answer");
      voice.listen({
        deferResult,
        onReplay: () => replays++,
        onResult: unexpected,
        onPartial: unexpected,
        onEmpty: unexpected,
        onError: unexpected,
      });
      const r = recognizers[0];
      const result = event === "partialresult"
        ? { partial: "kilo one repeat" }
        : { text: "kilo one repeat" };
      r.listeners[event]({ result });
      assert.equal(replays, 1);
      assert(r.removed);
      assert.equal(voice.recognizer, null);
      assert.equal(timers.size, 0);
      r.listeners.partialresult({ result: { partial: "repeat" } });
      r.listeners.result({ result: { text: "repeat" } });
      assert.equal(replays, 1);
    });
  }
}
test("no-speech timeout flushes audio without submitting an empty answer", () => {
  const { voice, recognizers, timers } = setup();
  let empty = 0,
    answers = 0;
  voice.listen({
    onResult() {
      answers++;
    },
    onPartial() {},
    onEmpty() {
      empty++;
    },
    onError() {},
  });
  [...timers.values()][0]();
  assert(recognizers[0].flushed);
  recognizers[0].listeners.result({ result: { text: "" } });
  assert.equal(empty, 1);
  assert.equal(answers, 0);
  assert.equal(timers.size, 0);
});
test("ending a session disconnects audio and stops microphone tracks", () => {
  const { voice } = setup();
  let stopped = 0,
    disconnected = 0;
  voice.node = {
    port: { postMessage() {} },
    disconnect() {
      disconnected++;
    },
  };
  voice.source = {
    disconnect() {
      disconnected++;
    },
  };
  voice.stream = {
    getTracks: () => [
      {
        stop() {
          stopped++;
        },
        onended() {},
      },
    ],
  };
  voice.closeMicrophone();
  assert.equal(stopped, 1);
  assert.equal(disconnected, 2);
  assert.equal(voice.stream, null);
});
test("microphone permission resolving after cancellation releases the late stream", async () => {
  const { voice, box } = setup();
  voice.stream = null;
  voice.node = null;
  let resolve;
  let stopped = 0;
  box.navigator.mediaDevices.getUserMedia = () =>
    new Promise((r) => (resolve = r));
  const result = voice.openMicrophone({});
  voice.closeMicrophone();
  resolve({
    getTracks: () => [
      {
        stop() {
          stopped++;
        },
      },
    ],
  });
  assert.equal(await result, false);
  assert.equal(stopped, 1);
});
test("AudioWorklet sends samples only inside the active answer window", () => {
  let Processor;
  const messages = [];
  const box = {
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { postMessage: (m) => messages.push(m) };
      }
    },
    Float32Array,
    registerProcessor(name, p) {
      Processor = p;
    },
  };
  vm.createContext(box);
  vm.runInContext(fs.readFileSync("dist/mic-worklet.js", "utf8"), box);
  const node = new Processor();
  const input = [[new Float32Array(2048).fill(0.1)]],
    output = [[new Float32Array(2048).fill(1)]];
  node.process(input, output);
  assert.equal(messages.length, 0);
  assert.equal(output[0][0][0], 0);
  node.port.onmessage({ data: { active: 7 } });
  node.process(input, output);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, 7);
  node.port.onmessage({ data: { active: null } });
  node.process(input, output);
  assert.equal(messages.length, 1);
});
test("restarting a voice session reuses its AudioWorklet registration", async () => {
  const { voice, box } = setup();
  voice.stream = null;
  voice.node = null;
  let stopped = 0,
    registered = 0;
  box.navigator.mediaDevices.getUserMedia = async () => ({
    active: true,
    getTracks: () => [
      {
        stop() {
          stopped++;
        },
      },
    ],
    getAudioTracks: () => [{}],
  });
  box.AudioWorkletNode = class {
    constructor() {
      this.port = { postMessage() {} };
    }
    connect() {}
    disconnect() {}
  };
  const context = {
    audioWorklet: {
      async addModule() {
        registered++;
      },
    },
    async resume() {},
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    },
    destination: {},
  };
  assert(await voice.openMicrophone(context));
  voice.closeMicrophone();
  assert(await voice.openMicrophone(context));
  voice.closeMicrophone();
  assert.equal(registered, 1);
  assert.equal(stopped, 2);
});

test("pauses between spoken letters accumulate into one answer", () => {
  const { voice, recognizers, timers } = setup();
  let answer = "";
  voice.listen({
    onResult: (t) => (answer = t),
    onPartial() {},
    onEmpty() {},
    onError() {},
  });
  const r = recognizers[0];
  r.listeners.result({ result: { text: "kilo one" } });
  const firstTimer = voice.settleTimeout;
  r.listeners.partialresult({ result: { partial: "alpha" } });
  assert(!timers.has(firstTimer));
  assert.equal(answer, "");
  r.listeners.result({ result: { text: "alpha bravo charlie" } });
  timers.get(voice.settleTimeout)();
  assert.equal(answer, "kilo one alpha bravo charlie");
});

test("speech collected during Morse playback is scored only after playback finishes", () => {
  const { voice, recognizers, timers } = setup();
  let answer = "",
    partial = "";
  voice.listen({
    deferResult: true,
    onResult: (t) => (answer = t),
    onPartial: (t) => (partial = t),
    onEmpty() {},
    onError() {},
  });
  assert.equal(voice.timeout, null);
  const r = recognizers[0];
  r.listeners.result({ result: { text: "nancy one" } });
  timers.get(voice.settleTimeout)();
  assert.equal(answer, "");
  r.listeners.partialresult({ result: { partial: "alpha" } });
  assert.equal(partial, "nancy one alpha");
  r.listeners.result({ result: { text: "alpha bravo" } });
  timers.get(voice.settleTimeout)();
  assert.equal(answer, "");
  voice.finishPlayback();
  assert.equal(answer, "nancy one alpha bravo");
  assert(r.removed);
});
test("speech still in progress at the end of Morse is retained", () => {
  const { voice, recognizers, timers } = setup();
  let answer = "";
  voice.listen({
    deferResult: true,
    onResult: (t) => (answer = t),
    onPartial() {},
    onEmpty() {},
    onError() {},
  });
  const r = recognizers[0];
  r.listeners.partialresult({ result: { partial: "november one" } });
  voice.finishPlayback();
  assert(voice.timeout);
  assert.equal(voice.recognizer, r);
  r.listeners.result({ result: { text: "november one alpha bravo" } });
  timers.get(voice.settleTimeout)();
  assert.equal(answer, "november one alpha bravo");
});
test("the no-speech deadline starts after Morse rather than before it", () => {
  const { voice, recognizers, timers } = setup();
  let empty = 0;
  voice.listen({
    deferResult: true,
    onResult() {},
    onPartial() {},
    onEmpty() {
      empty++;
    },
    onError() {},
  });
  assert.equal(voice.timeout, null);
  voice.finishPlayback();
  assert(voice.timeout);
  timers.get(voice.timeout)();
  assert(recognizers[0].flushed);
  recognizers[0].listeners.result({ result: { text: "" } });
  assert.equal(empty, 1);
});
test("stopping during Morse invalidates the deferred completion callback", () => {
  const { voice, recognizers } = setup();
  let answers = 0;
  voice.listen({
    deferResult: true,
    onResult() {
      answers++;
    },
    onPartial() {},
    onEmpty() {},
    onError() {},
  });
  const finish = voice.finishPlayback;
  voice.stop();
  finish();
  assert.equal(answers, 0);
  assert.equal(voice.timeout, null);
  assert(recognizers[0].removed);
});
test("Nancy and November normalize to the same letter N", () => {
  const context = {
    document: { getElementById() {} },
    crypto: require("node:crypto").webcrypto,
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync("dist/app.js", "utf8").split("let ctx,")[0],
    context,
  );
  assert.equal(
    vm.runInContext("normalize('Nancy one Alpha Bravo')", context),
    "N1AB",
  );
  assert.equal(
    vm.runInContext("normalize('November one Alpha Bravo')", context),
    "N1AB",
  );
  for (const word of ["Sugar", "Sierra"]) {
    assert.equal(
      vm.runInContext(`normalize('Kilo one ${word} Bravo')`, context),
      "K1SB",
    );
  }
});
