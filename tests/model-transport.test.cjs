const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

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
