const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("dist/app.js", "utf8");
const html = fs.readFileSync("dist/index.html", "utf8");

function harness(saved = null) {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) {
      const select = html.match(new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)</select>`));
      const input = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));
      elements.set(id, {
        value: select ? select[1].match(/value="([^"]*)"/)[1]
          : input?.[0].match(/value="([^"]*)"/)?.[1] || "",
        options: [{}], dataset: {},
        classList: { toggle() {} },
      });
    }
    return elements.get(id);
  };
  let stored = saved;
  let seed = 71;
  const box = vm.createContext({
    document: { getElementById: get, addEventListener() {} },
    window: { addEventListener() {} },
    localStorage: {
      getItem: () => stored,
      setItem: (key, value) => { stored = value; },
    },
    PracticeWakeLock: class { setActive() {} },
    LocalVoice: class { supported = true; },
    crypto: { getRandomValues(a) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      a[0] = seed;
    } },
  });
  vm.runInContext(source, box);
  return { get, run: (code) => vm.runInContext(code, box), stored: () => stored };
}

test("all formats retain their lengths, mix US/international, and play valid Morse", () => {
  const h = harness();
  for (const [format, pattern] of [
    ["short", /^[A-Z]\d[A-Z]{2}$/],
    ["long", /^[A-Z]\d[A-Z]{3}$/],
    ["two", /^[A-Z0-9]{2}\d[A-Z]{3}$/],
    ["mixed", /^(?:[A-Z]\d[A-Z]{2,3}|[A-Z0-9]{2}\d[A-Z]{3})$/],
  ]) {
    h.get("format").value = format;
    const calls = h.run("Array.from({length: 4000}, () => { newCall(); return current; })");
    let international = 0;
    for (const call of calls) {
      assert.match(call, pattern);
      if (!/^(?:[KNW]|A[A-L]|[KNW][A-Z])\d/.test(call)) international++;
    }
    assert(international > 1600 && international < 2400, `${format}: ${international}`);
    h.run("timings(current, 18, 12)");
  }
  const initials = h.run("new Set(Array.from({length: 4000}, () => generateCall('two')[0]))");
  for (const initial of ["A", "N", "D", "J", "V", "Z", "9", "S"]) assert(initials.has(initial));
});

test("US-only mode includes all AA–AL prefixes and no standalone Alpha prefix", () => {
  const h = harness();
  h.get("includeInternational").value = "no";
  const seen = new Set();
  for (const format of ["short", "long", "two", "mixed"]) {
    h.get("format").value = format;
    for (const call of h.run("Array.from({length: 4000}, () => { newCall(); return current; })")) {
      assert.match(call, /^(?:[KNW]|A[A-L]|[KNW][A-Z])\d[A-Z]{2,3}$/);
      seen.add(call.slice(0, 2));
    }
  }
  for (const letter of "ABCDEFGHIJKL") assert(seen.has("A" + letter));
});

test("international setting defaults on for new and existing users and remembers off", () => {
  assert.equal(harness().get("includeInternational").value, "yes");
  const h = harness(JSON.stringify({ format: "two", speed: "23" }));
  assert.equal(h.get("includeInternational").value, "yes");
  assert.equal(h.get("format").value, "two");
  h.get("includeInternational").value = "no";
  h.get("includeInternational").onchange();
  const reload = harness(h.stored());
  assert.equal(reload.get("includeInternational").value, "no");
  assert.equal(reload.get("speed").value, "23");
});
