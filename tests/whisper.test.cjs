const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
function setup() {
  const timers = new Map();
  let timerId = 0;
  const box = {
    window: {}, Float32Array, WeakSet, Map,
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  };
  vm.createContext(box);
  for (const file of ["speech.js", "whisper.js"])
    vm.runInContext(fs.readFileSync("dist/" + file, "utf8"), box);
  const voice = new box.window.WhisperVoice(() => {});
  voice.model = { ready: true };
  voice.stream = { active: true };
  voice.context = { sampleRate: 48000 };
  voice.node = { port: { postMessage() {} } };
  const jobs = [];
  voice.request = (message) => new Promise((resolve, reject) => jobs.push({ message, resolve, reject }));
  const answers = [], partials = [], errors = [];
  let empty = 0, replays = 0;
  const options = {
    onResult: text => answers.push(text), onPartial: text => partials.push(text),
    onEmpty: () => empty++, onReplay: () => replays++, onError: error => errors.push(error),
  };
  const phrase = () => {
    voice.recognizer.acceptWaveformFloat(new Float32Array(4800).fill(0.1));
    voice.recognizer.acceptWaveformFloat(new Float32Array(60000));
  };
  return { box, voice, jobs, answers, partials, errors, options, phrase, timers,
    empty: () => empty, replays: () => replays };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test("Whisper resamples microphone PCM to 16 kHz and defers incomplete copies until Morse ends", async () => {
  const t = setup();
  t.voice.listen({ ...t.options, deferResult: true });
  t.phrase();
  assert.equal(t.jobs.length, 1);
  assert.equal(t.jobs[0].message.samples.length, 21600);
  assert.equal(t.voice.timeout, null);
  t.jobs[0].resolve({ text: "Kilo one Alpha Bravo." });
  await tick();
  assert.deepEqual(t.answers, []);
  assert.deepEqual(t.partials, ["Kilo one Alpha Bravo."]);
  t.voice.finishPlayback();
  assert.deepEqual(t.answers, ["Kilo one Alpha Bravo."]);
});
test("Whisper ignores inference arriving after replay or session cancellation", async () => {
  const t = setup();
  t.voice.listen(t.options); t.phrase();
  t.voice.stop();
  t.voice.listen(t.options);
  t.jobs[0].resolve({ text: "repeat" });
  await tick();
  assert.equal(t.replays(), 0);
  assert.deepEqual(t.answers, []);
  assert(t.voice.recognizer);
});
test("Whisper repeat works during Morse without submitting a copy", async () => {
  const t = setup();
  t.voice.listen({ ...t.options, deferResult: true }); t.phrase();
  t.jobs[0].resolve({ text: "Repeat!" }); await tick();
  assert.equal(t.replays(), 1);
  assert.deepEqual(t.answers, []);
  assert.equal(t.voice.recognizer, null);
});
test("Whisper correct copies can score during Morse", async () => {
  const t = setup();
  t.voice.listen({ ...t.options, deferResult: true, isComplete: text => text === "N1AB" });
  t.phrase(); t.jobs[0].resolve({ text: "N1AB" }); await tick();
  assert.deepEqual(t.answers, ["N1AB"]);
  assert.equal(t.voice.recognizer, null);
});
test("Whisper retains additional speech while a previous segment is transcribing", async () => {
  const t = setup();
  t.voice.listen(t.options); t.phrase(); t.phrase();
  assert.equal(t.jobs.length, 1);
  t.jobs[0].resolve({ text: "Nancy one" }); await tick();
  assert.equal(t.jobs.length, 2);
  assert.deepEqual(t.answers, []);
  t.jobs[1].resolve({ text: "Alpha Bravo" }); await tick();
  assert.deepEqual(t.answers, ["Nancy one Alpha Bravo"]);
});
test("Whisper timeout waits for pending transcription and flushes buffered speech", async () => {
  const t = setup();
  t.voice.listen(t.options); t.phrase();
  t.voice.recognizer.acceptWaveformFloat(new Float32Array(4800).fill(0.1));
  t.timers.get(t.voice.timeout)();
  t.jobs[0].resolve({ text: "Kilo one" }); await tick();
  assert.equal(t.jobs.length, 2);
  t.jobs[1].resolve({ text: "Alpha" }); await tick();
  assert.deepEqual(t.answers, ["Kilo one Alpha"]);
});
test("Whisper ignores silence rather than asking the model to hallucinate a transcript", () => {
  const t = setup();
  t.voice.listen(t.options);
  t.voice.recognizer.acceptWaveformFloat(new Float32Array(96000));
  t.timers.get(t.voice.timeout)();
  assert.equal(t.jobs.length, 0);
  assert.equal(t.empty(), 1);
});
test("Whisper failures release capture and offer the app its normal fallback", async () => {
  const t = setup();
  t.voice.listen(t.options); t.phrase();
  t.jobs[0].reject(new Error("model failed")); await tick();
  assert.equal(t.errors[0].message, "model failed");
  assert.equal(t.voice.recognizer, null);
  assert.equal(t.timers.size, 0);
});
test("Whisper worker setup failure can be retried without reloading the page", async () => {
  const t = setup();
  t.voice.model = null;
  t.voice.node = null;
  t.voice.stream = null;
  let attempts = 0;
  t.box.Worker = class {
    constructor() { attempts++; throw new Error("worker blocked"); }
  };
  await assert.rejects(t.voice.load(), /worker blocked/);
  await assert.rejects(t.voice.load(), /worker blocked/);
  assert.equal(attempts, 2);
});
test("disposing Whisper rejects pending work and releases the worker and microphone", async () => {
  const t = setup();
  // Use the real request method for this lifecycle check.
  t.voice.request = t.box.window.WhisperVoice.prototype.request;
  let terminated = false, stopped = false;
  t.voice.worker = { postMessage() {}, terminate() { terminated = true; } };
  t.voice.node.disconnect = () => {};
  t.voice.stream = { getTracks: () => [{ stop() { stopped = true; } }] };
  const request = t.voice.request({ type: "load" });
  t.voice.dispose();
  await assert.rejects(request, /closed/);
  assert(terminated && stopped);
  assert.equal(t.voice.requests.size, 0);
  assert.equal(t.voice.model, null);
  assert.equal(t.timers.size, 0);
});
