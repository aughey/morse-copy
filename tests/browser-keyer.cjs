const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() =>
    localStorage.setItem("morse-copy-hide-welcome", "true"),
  );
  await page.goto(process.argv[2] || "http://127.0.0.1:8765");
  const results = await page.evaluate(async () => {
    const engine = new LocalKeyer();
    const start = performance.now();
    await engine.load();
    const loaded = Math.round(performance.now() - start);
    async function decode(call, wpm, hz, rate = 48000) {
      const seq = timings(call, wpm, wpm),
        lead = 0.5;
      const samples = new Float32Array(
        Math.ceil((seq.duration + lead + 1) * rate),
      );
      for (const e of seq.events) {
        const n = Math.round(e.duration * rate),
          at = Math.round((e.at + lead) * rate);
        for (let i = 0; i < n; i++)
          samples[at + i] =
            0.3 *
            Math.sin((2 * Math.PI * hz * (at + i)) / rate) *
            Math.min(1, i / (0.005 * rate), (n - i) / (0.005 * rate));
      }
      const id = ++engine.captureId;
      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(Error("inference timeout")),
          45000,
        );
        engine.callbacks = {
          onPartial() {},
          onResult(text) {
            clearTimeout(timeout);
            resolve(text);
          },
          onEmpty() {
            clearTimeout(timeout);
            resolve("");
          },
          onError: reject,
        };
        engine.worker.postMessage({ type: "start", id, rate });
        for (let i = 0; i < samples.length; i += 2048) {
          const chunk = samples.slice(i, i + 2048);
          engine.worker.postMessage({ type: "samples", id, samples: chunk }, [
            chunk.buffer,
          ]);
        }
        engine.worker.postMessage({ type: "finish", id });
      });
    }
    const results = [];
    for (const [call, wpm, hz] of [
      ["K1ABC", 18, 600],
      ["N0AA", 25, 800],
      ["9A2TO", 12, 500],
      ["", 18, 600],
    ])
      results.push({ call, decoded: await decode(call, wpm, hz) });
    engine.worker.terminate();
    return { loaded, results };
  });
  console.log(JSON.stringify(results));
  for (const r of results.results)
    assert.equal(r.decoded.replace(/\s/g, ""), r.call);
  await page.evaluate(() => {
    window.testMicContext = new AudioContext();
    window.testMicDestination = testMicContext.createMediaStreamDestination();
    navigator.mediaDevices.getUserMedia = async () => testMicDestination.stream;
  });
  await page
    .locator("details")
    .filter({ has: page.locator("#inputMode") })
    .evaluate((x) => (x.open = true));
  await page.selectOption("#inputMode", "keyer");
  await page.click("#start");
  await page.waitForFunction(() => running, {}, { timeout: 45000 });
  assert.equal(await page.evaluate(() => localVoice.model), null);
  assert.equal(await page.evaluate(() => phase), "playing");
  assert.equal(await page.evaluate(() => localKeyer.callbacks), null);
  await page.waitForFunction(
    () => phase === "listening",
    {},
    { timeout: 30000 },
  );

  assert.equal(await page.evaluate(() => !!localKeyer.callbacks), true);
  async function send(call, target) {
    await page.evaluate(
      ({ call, target }) => {
        current = target;
        const seq = timings(call, 18, 18),
          rate = testMicContext.sampleRate;
        const buffer = testMicContext.createBuffer(
          1,
          Math.ceil((seq.duration + 1) * rate),
          rate,
        );
        const samples = buffer.getChannelData(0);
        for (const e of seq.events) {
          const n = Math.round(e.duration * rate),
            at = Math.round((e.at + 0.2) * rate);
          for (let i = 0; i < n; i++)
            samples[at + i] =
              0.2 *
              Math.sin((2 * Math.PI * 600 * (at + i)) / rate) *
              Math.min(1, i / (0.005 * rate), (n - i) / (0.005 * rate));
        }
        const source = testMicContext.createBufferSource();
        source.buffer = buffer;
        source.connect(testMicDestination);
        source.start();
      },
      { call, target },
    );
  }
  await send("K1ABC", "K1ABC");
  await page.waitForFunction(() => total === 1, {}, { timeout: 25000 });
  assert.equal(await page.evaluate(() => correct), 1);
  console.log(
    "Matching call automatically scored through real AudioWorklet and model",
  );
  await page.waitForFunction(
    () => phase === "listening",
    {},
    { timeout: 25000 },
  );
  await send("K1ABD", "N0AA");
  await page.waitForFunction(() => total === 2, {}, { timeout: 25000 });
  assert.equal(await page.evaluate(() => correct), 1);
  assert.match(
    await page.locator("#feedback").textContent(),
    /K1ABD.*Try again/,
  );
  console.log("Incorrect call automatically checked after silence");
  await page.click("#pause");
  assert.equal(await page.evaluate(() => localKeyer.stream), null);
  await page.selectOption("#inputMode", "voice");
  assert.equal(
    await page.locator("#modeBadge").textContent(),
    "VOSK · ON DEVICE",
  );
  const voiceOpened = await page.evaluate(async () => {
    testMicDestination = testMicContext.createMediaStreamDestination();
    const opened = await localVoice.openMicrophone(ctx);
    localVoice.closeMicrophone();
    return opened;
  });
  assert.equal(voiceOpened, true);
  assert.deepEqual(errors, []);
  await page.evaluate(() => testMicContext.close());
  console.log("Browser lifecycle and independent voice mode passed");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
