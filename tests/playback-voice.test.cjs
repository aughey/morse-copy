const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
test("practice starts voice capture before the first Morse tone and retains it after playback", async () => {
  const elements = new Map();
  const events = [];
  let finishAudio;
  const values = {
    speed: "18",
    spacing: "12",
    tone: "600",
    volume: "65",
    inputMode: "voice",
    format: "short",
  };
  const get = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        value: values[id] || "",
        options: [{}],
        dataset: {},
        classList: { toggle() {}, remove() {}, add() {} },
        setAttribute() {},
        focus() {},
      });
    return elements.get(id);
  };
  const box = {
    document: { getElementById: get, addEventListener() {} },
    window: { addEventListener() {} },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
    },
    PracticeWakeLock: class {
      setActive() {}
      acquire() {}
    },
    LocalVoice: class {
      supported = true;
      stop() {
        this.finishPlayback = null;
      }
      closeMicrophone() {}
      listen(options) {
        events.push("listen");
        this.callbacks = options;
        this.finishPlayback = () => events.push("playback-finished");
      }
    },
    crypto: require("node:crypto").webcrypto,
  };
  vm.createContext(box);
  vm.runInContext(fs.readFileSync("dist/app.js", "utf8"), box);
  box.events = events;
  box.setTimeout = (resolve) => {
    finishAudio = resolve;
  };
  vm.runInContext(
    "running=true;current='N1AB';ctx={currentTime:0};audio=async()=>{};tone=()=>events.push('tone')",
    box,
  );
  const played = vm.runInContext("play()", box);
  await new Promise((r) => setImmediate(r));
  assert.equal(events[0], "listen");
  assert(events.includes("tone"));
  assert.equal(vm.runInContext("localVoice.callbacks.deferResult", box), true);
  vm.runInContext(
    "localVoice.callbacks.onPartial('nancy one alpha bravo')",
    box,
  );
  assert.equal(get("feedback").textContent, "Hearing: nancy one alpha bravo");
  finishAudio();
  await played;
  assert.equal(events.filter((e) => e === "listen").length, 1);
  assert.equal(events.at(-1), "playback-finished");
  assert.equal(vm.runInContext("phase", box), "listening");
  // A voice replay invokes playback directly and preserves all scoring state.
  vm.runInContext(
    "total=4;correct=3;streak=2;attempted=false;play=()=>events.push('replay')",
    box,
  );
  vm.runInContext("localVoice.callbacks.onReplay()", box);
  assert.equal(events.at(-1), "replay");
  assert.equal(vm.runInContext("current", box), "N1AB");
  assert.equal(vm.runInContext("total", box), 4);
  assert.equal(vm.runInContext("correct", box), 3);
  assert.equal(vm.runInContext("streak", box), 2);
  assert.equal(vm.runInContext("attempted", box), false);
  const replayCount = events.filter((e) => e === "replay").length;
  vm.runInContext("invalidate();localVoice.callbacks.onReplay()", box);
  assert.equal(events.filter((e) => e === "replay").length, replayCount);

  // A correct live copy can score during playback and advance the call once.
  vm.runInContext("answerTurn(epoch, true)", box);
  for (const text of ["nancy one alpha bravo", "november one alpha bravo", "N1AB"])
    assert.equal(vm.runInContext(`localVoice.callbacks.isComplete(${JSON.stringify(text)})`, box), true);
  for (const text of ["nancy one alpha", "nancy one alpha charlie", "nancy one alpha bravo charlie"])
    assert.equal(vm.runInContext(`localVoice.callbacks.isComplete(${JSON.stringify(text)})`, box), false);
  vm.runInContext("localVoice.callbacks.onResult('nancy one alpha bravo')", box);
  await new Promise((r) => setImmediate(r));
  assert.equal(vm.runInContext("phase", box), "feedback");
  assert.equal(vm.runInContext("total", box), 5);
  assert.equal(vm.runInContext("correct", box), 4);
  assert.equal(get("feedback").textContent, "Your copy: N1AB · Correct");
  vm.runInContext("localVoice.callbacks.onResult('nancy one alpha bravo')", box);
  assert.equal(vm.runInContext("total", box), 5);
  vm.runInContext("newCall=()=>events.push('next-call')", box);
  finishAudio();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(events.slice(-2), ["next-call", "replay"]);
});
