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
  await page.evaluate(() => {
    const codes = [
      ".-", "-...", "-.-.", "-..", ".", "..-.", "--.", "....", "..", ".---",
      "-.-", ".-..", "--", "-.", "---", ".--.", "--.-", ".-.", "...", "-",
      "..-", "...-", ".--", "-..-", "-.--", "--..",
      "-----", ".----", "..---", "...--", "....-", ".....", "-....", "--...", "---..", "----.",
    ];
    const context = new AudioContext();
    const destination = context.createMediaStreamDestination();
    navigator.mediaDevices.getUserMedia = async () => destination.stream;
    window.sendMorse = async call => {
      await context.resume();
      const rate = context.sampleRate;
      const dot = 1.2 / 18;
      let t = 0.3;
      const marks = [];
      for (const letter of call) {
        for (const mark of codes["ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".indexOf(letter)]) {
          const duration = dot * (mark === "-" ? 3 : 1);
          marks.push([t, duration]);
          t += duration + dot;
        }
        t += 2 * dot;
      }
      const buffer = context.createBuffer(1, Math.ceil((t + 0.5) * rate), rate);
      const samples = buffer.getChannelData(0);
      for (const [at, duration] of marks) {
        const n = Math.round(duration * rate);
        for (let i = 0; i < n; i++) {
          samples[Math.round(at * rate) + i] = 0.3 * Math.sin(2 * Math.PI * 600 * i / rate) *
            Math.min(1, i / (0.005 * rate), (n - i) / (0.005 * rate));
        }
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(destination);
      source.start();
    };
    window.micTrack = destination.stream.getAudioTracks()[0];
  });
  const select = page.locator("#inputMode");
  await select.evaluate(input => input.closest("details").open = true);
  await select.selectOption("keyer");
  await page.locator("#includeInternational").evaluate(input => {
    input.value = "no";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.locator("#format").evaluate(input => {
    input.value = "long";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  // Use a known, reproducible call for the synthetic inference fixture.
  await page.evaluate(() => {
    const original = Math.random;
    const draws = [0, 0.1, 0, 1.5 / 26, 2.5 / 26];
    Math.random = () => {
      const draw = draws.shift();
      if (draws.length === 0) Math.random = original;
      return draw;
    };
  });
  await page.locator("#start").click();
  await page.getByText("Your turn. Send your copy.", { exact: true }).waitFor({ timeout: 60_000 });
  await page.locator("#reveal").click();
  const call = await page.locator("#call").textContent();
  assert.equal(call, "K1ABC");
  await page.locator("#replay").click();
  await page.getByText("Your turn. Send your copy.", { exact: true }).waitFor();
  await page.evaluate(call => sendMorse(call), call);
  await page.getByText("Good copy. Nicely done.", { exact: true }).waitFor({ timeout: 25_000 });
  assert.equal(await page.locator("#correct").textContent(), "1");

  await page.getByText("Your turn. Send your copy.", { exact: true }).waitFor({ timeout: 20_000 });
  await page.evaluate(() => sendMorse("DL1ABC"));
  await page.getByText("Not quite. Listen again.", { exact: true }).waitFor({ timeout: 25_000 });
  assert.match(await page.locator("#feedback").textContent(), /DL1ABC.*Try again/);
  await page.locator("#pause").click();
  await page.waitForFunction(() => micTrack.readyState === "ended");
  assert.deepEqual(errors, []);
  console.log("Real AudioWorklet and DeepCW checked correct and incorrect synthetic keyer audio.");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
