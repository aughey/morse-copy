const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function timing(call, wpm, effective) {
  const context = vm.createContext({ document: { getElementById() {} } });
  vm.runInContext(
    fs.readFileSync("dist/app.js", "utf8").split("let ctx,")[0],
    context,
  );
  return vm.runInContext(
    `timings(${JSON.stringify(call)}, ${wpm}, ${effective})`,
    context,
  );
}
const near = (actual, expected) => assert(Math.abs(actual - expected) < 1e-10);

test("N keeps its dash-dot timing and one-dot intra-character gap", () => {
  const { events, duration } = timing("N", 20, 20);
  assert.equal(events.length, 2);
  near(events[0].duration, 0.18);
  near(events[1].at, 0.24);
  near(events[1].duration, 0.06);
  near(duration, 0.3);
});

test("slower effective speed extends letter spacing without changing tone lengths", () => {
  const normal = timing("EE", 20, 20);
  const spaced = timing("EE", 20, 10);
  near(normal.events[1].at - normal.events[0].duration, 0.18);
  near(spaced.events[0].duration, normal.events[0].duration);
  near(spaced.events[1].duration, normal.events[1].duration);
  assert(spaced.events[1].at > normal.events[1].at);
  near(timing("EE", 20, 40).duration, normal.duration);
});
