Run `node --test tests/voice.test.cjs` for recognition lifecycle, cancellation, microphone cleanup, capture gating, and segmented-answer tests.

Browser integration validation performed against the managed preview:
- Loaded the actual vendored Vosk WebAssembly engine and all five local model parts.
- Decoded the Vosk upstream test recording with the fixed practice vocabulary.
- Reloaded the page and decoded again with the persisted model.
- Checked the keyboard practice route and existing Morse playback.

`browser-voice.html` is a temporary integration harness. To rerun it, copy it into dist/qa.html and place the upstream Vosk test WAV at dist/qa-test.wav. Remove both preview files before publication. The harness is not shipped in the site.

Live microphone permission and audio capture require HTTPS. The HTTP preview cannot test those browser APIs. Phone latency and real spoken call sign accuracy still require testing on the target device.
