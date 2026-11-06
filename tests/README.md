Run `node --test tests/voice.test.cjs` for recognition lifecycle, cancellation, microphone cleanup, capture gating, and segmented-answer tests.

Browser integration validation performed against the managed preview:
- Loaded the actual vendored Vosk WebAssembly engine and all five local model parts.
- Decoded the Vosk upstream test recording with the fixed practice vocabulary.
- Reloaded the page and decoded again with the persisted model.
- Checked the keyboard practice route and existing Morse playback.

`browser-voice.html` is a temporary integration harness. To rerun it, copy it into dist/qa.html and place the upstream Vosk test WAV at dist/qa-test.wav. Remove both preview files before publication. The harness is not shipped in the site.

Live microphone permission and audio capture require HTTPS. The HTTP preview cannot test those browser APIs. Phone latency and real spoken call sign accuracy still require testing on the target device.

Keyer unit/lifecycle tests run with `node --test tests/keyer.test.cjs` (also included in `npm test`). They cover immediate matching copies, automatic checking after silence, tone detection at 44.1/48 kHz, stale results, final sample flushing, late microphone permission, worker failures, and finalization during an in-flight decode.

`browser-keyer.cjs` exercises the real vendored ONNX Runtime and DeepCW model with synthesized Morse, then routes synthesized keyer audio through a real browser MediaStream and AudioWorklet. It verifies that matching calls score hands-free, incorrect calls score after silence, keyer capture waits for playback, microphone tracks close, and voice remains independent. With Playwright and its Chromium browser installed in your test environment:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory dist
# In a second terminal:
node tests/browser-keyer.cjs http://127.0.0.1:8765
```

Playwright is an optional verification dependency; it is not bundled or needed to build/run the app. The loopback address is a secure context for browser microphone APIs. These synthesized-audio checks do not replace testing an actual keyer speaker and computer microphone in a room.
