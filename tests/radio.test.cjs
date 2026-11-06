const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function receiver(options = {}) {
  const sources = [], nodes = [], buffers = [];
  const param = () => ({
    calls: [],
    setValueAtTime(...args) { this.calls.push(["set", ...args]); },
    linearRampToValueAtTime(...args) { this.calls.push(["ramp", ...args]); },
    setValueCurveAtTime(...args) { this.calls.push(["curve", ...args]); },
  });
  const node = () => {
    const n = {
      gain: param(), frequency: param(), Q: param(),
      connect(to) { this.destination = to; },
      disconnect() { this.disconnected = true; },
      start(at) { this.startAt = at; },
      stop(at) { this.stopAt = at; },
    };
    nodes.push(n);
    return n;
  };
  const ctx = {
    sampleRate: 8000,
    destination: {},
    createGain: node,
    createBiquadFilter: node,
    createBuffer(channels, length) {
      const data = new Float32Array(length);
      buffers.push(data);
      return { getChannelData: () => data };
    },
    createBufferSource() { const n = node(); sources.push(n); return n; },
    createOscillator() { const n = node(); sources.push(n); return n; },
  };
  const box = vm.createContext({ ctx, options: {
    staticLevel: 0, interference: 0, fading: 0, volume: 0.65, hz: 600, ...options,
  } });
  vm.runInContext(fs.readFileSync("dist/radio.js", "utf8"), box);
  const radio = vm.runInContext("new RadioEnvironment(ctx, 1, 6, options)", box);
  return { radio, sources, nodes, buffers };
}

test("fading varies received strength smoothly without boosting or erasing the signal", () => {
  const faded = receiver({ fading: 100 });
  const curve = faded.radio.input.gain.calls[0][1];
  assert(curve.every((v) => v > 0 && v <= 1));
  assert(Math.max(...curve) - Math.min(...curve) > 0.1);
  assert(curve.slice(1).every((v, i) => Math.abs(v - curve[i]) < 0.08));
});

test("all radio layers share master mute and are disconnected on interruption", () => {
  const { radio, sources, nodes, buffers } = receiver({
    staticLevel: 100, interference: 100, fading: 100, volume: 0,
  });
  assert.equal(sources.length, 4);
  assert(nodes[0].gain.calls.every((call) => call[1] === 0));
  assert(buffers.every((data) => data.every((v) => Number.isFinite(v) && Math.abs(v) <= 1)));
  assert(sources.every((n) => n.startAt >= 0 && n.stopAt === 7.12));
  radio.stop();
  assert(sources.every((n) => n.stopAt === undefined));
  assert(nodes.every((n) => n.disconnected));
  radio.stop();
});

test("all effects at zero allocate no audio nodes or buffers", () => {
  const { radio, sources, nodes, buffers } = receiver();
  assert.equal(nodes.length, 0);
  assert.equal(sources.length, 0);
  assert.equal(buffers.length, 0);
  assert.equal(radio.input, undefined);
  radio.stop();
});

test("each effect at zero is absent when other effects are enabled", () => {
  const staticOnly = receiver({ staticLevel: 50 });
  assert.equal(staticOnly.sources.length, 2);
  assert(staticOnly.sources.every((n) => n.buffer));
  assert.equal(staticOnly.nodes.length, 7); // Output, two filters/gains/sources.
  assert(!staticOnly.nodes.some((n) => n.gain.calls.some((c) => c[0] === "curve")));

  const interferenceOnly = receiver({ interference: 50 });
  assert.equal(interferenceOnly.sources.length, 2);
  assert.equal(interferenceOnly.buffers.length, 0);
  assert.equal(interferenceOnly.nodes.length, 5); // Output and two oscillator/gain pairs.
  assert(!interferenceOnly.nodes.some((n) => n.gain.calls.some((c) => c[0] === "curve")));

  const fadingOnly = receiver({ fading: 50 });
  assert.equal(fadingOnly.sources.length, 0);
  assert.equal(fadingOnly.buffers.length, 0);
  assert.equal(fadingOnly.nodes.length, 2); // Output and fading gain only.
  fadingOnly.radio.stop();
  assert(fadingOnly.nodes.every((n) => n.disconnected));
});

test("finishing playback releases the noise graph without waiting for the next call", () => {
  const { radio, sources, nodes } = receiver({ staticLevel: 50, interference: 50 });
  for (const source of sources) source.onended();
  assert.equal(radio.sources.size, 0);
  assert(nodes.every((n) => n.disconnected));
});
