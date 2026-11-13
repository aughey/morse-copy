const { chromium } = require("playwright");
const assert = require("node:assert/strict");

(async () => {
  const browser = await chromium.launch({
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const base = process.argv[2] || "http://localhost:8000/";
    await page.goto(base);
    await page.locator("#welcome[open]").waitFor();
    await page.locator("#hideWelcome").check();
    await page.getByRole("button", { name: "Set up practice" }).click();
    await page.locator("#inputMode").evaluate(select => select.closest("details").open = true);
    await page.locator("#inputMode").selectOption("type");
    await page.locator("#speed").fill("40");
    await page.locator("#spacing").fill("40");
    await page.locator("#fading").evaluate(input => input.closest("details").open = true);
    for (const effect of ["staticLevel", "interference", "fading"]) {
      await page.locator("#" + effect).fill("30");
    }
    await page.locator("#start").click();
    await page.locator("#answer:enabled").waitFor();
    assert.equal(await page.locator("#answer").evaluate(input => document.activeElement === input), true);
    await page.locator("#reveal").click();
    const call = (await page.locator("#call").textContent()).trim();
    assert.match(call, /^[A-Z0-9]{4,6}$/);
    assert.equal(await page.locator("#accuracy").textContent(), "0%");
    await page.locator("#replay").click();
    await page.locator("#answer:enabled").fill(call);
    await page.locator("#submit").click();
    await page.getByText("Good copy. Nicely done.").waitFor();
    assert.equal(await page.locator("#correct").textContent(), "1");
    assert.equal(await page.locator("#accuracy").textContent(), "50%");
    assert.equal(await page.locator("#streak").textContent(), "1");
    assert.equal(await page.locator("#maxStreak").textContent(), "1");
    await page.locator("#answer:enabled").fill("A");
    await page.locator("#submit").click();
    await page.getByText("Not quite. Listen again.").waitFor();
    assert.equal(await page.locator("#streak").textContent(), "0");
    assert.equal(await page.locator("#maxStreak").textContent(), "1");
    await page.locator("#pause").click();
    assert.equal(await page.locator("#maxStreak").textContent(), "1");

    await page.reload();
    await page.locator("#start").waitFor();
    assert.equal(await page.locator("#maxStreak").textContent(), "0");
    assert.equal(await page.locator("#welcome").evaluate(dialog => dialog.open), false);
    assert.equal(await page.locator("#inputMode").inputValue(), "type");
    assert.equal(await page.locator("#speed").inputValue(), "40");

    await page.evaluate(() => {
      const devices = navigator.mediaDevices;
      const open = devices.getUserMedia.bind(devices);
      window.testStreams = [];
      devices.getUserMedia = async constraints => {
        const stream = await open(constraints);
        testStreams.push({ stream, constraints });
        return stream;
      };
    });
    await page.locator("#inputMode").evaluate(select => select.closest("details").open = true);
    for (const [mode, hint, speech] of [
      ["keyer", "Your turn. Send your copy.", false],
      ["voice", "Listen and say your copy.", true],
    ]) {
      await page.locator("#inputMode").selectOption(mode);
      await page.locator("#start").click();
      await page.getByText(hint, { exact: true }).waitFor({ timeout: 120_000 });
      assert.equal(await page.evaluate(() => testStreams.at(-1).constraints.audio.echoCancellation), speech);
      await page.locator("#pause").click();
      await page.waitForFunction(() => testStreams.at(-1).stream.getTracks().every(track => track.readyState === "ended"));
    }
    await page.evaluate(() => {
      const { get } = Object.getOwnPropertyDescriptor(Vosk.Model.prototype, "KaldiRecognizer");
      Object.defineProperty(Vosk.Model.prototype, "KaldiRecognizer", {
        get() {
          return new Proxy(get.call(this), {
            construct(target, args) {
              const recognizer = Reflect.construct(target, args);
              (window.recognizers ||= []).push(recognizer);
              return recognizer;
            },
          });
        },
      });
    });
    await page.locator("#start").click();
    await page.waitForFunction(() => window.recognizers?.length === 1);
    await page.locator("#reveal").click();
    const spokenCall = await page.locator("#call").textContent();
    await page.locator("#replay").click();
    await page.waitForFunction(() => recognizers.length === 2);
    await page.evaluate(call => {
      const event = text => new CustomEvent("partialresult", { detail: { result: { partial: text } } });
      recognizers[0].dispatchEvent(event(call)); // The canceled capture cannot score.
      recognizers[1].dispatchEvent(event("repeat"));
    }, spokenCall);
    await page.waitForFunction(() => recognizers.length === 3);
    assert.equal(await page.locator("#correct").textContent(), "0");
    await page.evaluate(call => {
      recognizers[2].dispatchEvent(new CustomEvent("partialresult", {
        detail: { result: { partial: call } },
      }));
    }, spokenCall);
    await page.getByText("Good copy. Nicely done.", { exact: true }).waitFor();
    assert.equal(await page.locator("#correct").textContent(), "1");
    await page.locator("#pause").click();
    await page.waitForFunction(() => testStreams.at(-1).stream.getTracks().every(track => track.readyState === "ended"));
    assert.deepEqual(errors, []);
    console.log("Keyboard flow, settings, audio effects, model startup, voice events, and microphone cleanup passed.");
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
