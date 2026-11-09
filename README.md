# Morse Copy

Practice copying Morse call signs by ear, using voice, an external audio keyer, or keyboard answers.

Select **Start random words** for continuous copy practice by ear or on paper. The app loads 500 words from `dist/words.json` on the same site and plays them in shuffled order using your station audio settings. To focus on particular letters, enter them in **Random word letters** before starting. Each word must contain at least one of the entered letters. The filter ignores case and nonletters. The stream continues through a fresh shuffle after each pass. Select **End practice** to stop. Word practice requires no microphone or answers and leaves call sign scores alone.

**Live app:** https://aughey.github.io/morse-copy/

## Source and behavior

Morse Copy is a Leptos client-side app compiled to WebAssembly. The static files in `_site/` can be hosted on GitHub Pages or any static host. The `pre-leptos` Git tag records the original JavaScript release.

- `src/view.rs` renders the station and settings with Leptos.
- `src/session.rs` manages practice, scoring, and cancellation. `src/settings.rs` reads and writes browser preferences.
- `src/morse.rs` and `src/audio.rs` generate calls and schedule Morse, radio effects, and feedback.
- `src/detection.rs` owns microphone capture and answer timing. It binds to Vosk using wasm-bindgen and exchanges typed audio buffers and transcript events with the DeepCW worker. Rust futures await model readiness and recognition events.
- `dist/` contains the static shell, styles, vendored inference runtimes and models, the DeepCW inference adapter, and the microphone AudioWorklet.

- A startup welcome screen explains hands-free practice with pen or pencil and paper. **Don’t show this again** is saved locally in the browser; **How to practice** in the footer reopens the instructions and lets you change that choice.
- International call signs are included by default in a roughly even mix with U.S. calls. Turn **Include international call signs** off for U.S.-only practice; the choice is remembered, including across upgrades from older settings. Call sign format still controls prefix/suffix length. U.S. two-letter prefixes include AA–AL, with A/K/N/W initials sampled evenly. International practice uses a curated set of prefixes, including digit-leading examples such as 9A, 9H, and S5; generated calls are not a registry of assigned stations. Prefix references: [ARRL](https://www.arrl.org/international-call-sign-series), [RSGB](https://rsgb.org/main/operating/licensing-novs-visitors/international-prefixes/).
- Web Audio Morse playback, speed/spacing/tone controls, and feedback sounds.
- **Call sign format** includes head-copy practice from **1 × 1** through **2 × 3**. Each side varies from one letter up to the selected maximum, around exactly one digit (0–9); for example, **2 × 2** mixes K1A, K1AB, KA1B, and KA1BC shapes. Start with **1 × 1** to hold a whole call in memory and answer aloud hands-free, then increase the lengths. These practice shapes need not be assigned call sign formats. Existing fixed formats remain available, and the selection is remembered.
- Optional HF static (filtered hiss and crackles), interference (nearby CW and a drifting carrier), and signal fading with a different strength on each playback. Expand **Radio environment** in Station settings; each effect has its own 0–100% control and defaults to off. Effects follow the volume setting, run during call sign playback including letter gaps, and stop when playback ends or practice is interrupted. Settings are remembered and apply to the next playback.
- **Call sign format** and **Answer with** are collapsed by default, like Radio environment. Expand them to adjust call generation or input options.
- On-device Vosk recognition, with Nancy/November mapping to N and Sugar/Sierra mapping to S. Saying “repeat” replays immediately, including during playback, without counting an attempt.
- Concurrent listening during Morse playback. A complete, correct spoken call sign scores immediately without waiting for silence, even during playback; other answers are scored after playback completes and speech settles.
- **Answer with → External keyer · Morse audio** listens through the computer microphone for your keyer’s speaker. Wait for practice playback to finish, then send the received call sign in Morse. Decoded letters appear live. A complete matching copy scores immediately; otherwise about 1.8 seconds without keyer tones or new decoded letters triggers a check. No clicks are needed between call signs. Long pauses can submit a partial answer. A 60-second limit finishes each answer; empty decoding counts no attempt. Repeat, Reveal, End practice, mode changes, and page hiding cancel pending results. Voice remains an independent option.
- Screen wake lock during practice and model loading, release on completion/hide, and retry support.

All URLs are relative so assets and microphone worklets work under `/morse-copy/`. Voice initially downloads approximately 40 MB from the same site; the browser caches the extracted model. Speech audio is processed locally.

Radio effects set to 0 are omitted from the audio processing chain: no corresponding noise buffers, oscillators, filters, or fading automation are created. With all three at 0, Morse uses the direct clean-audio path. In random-word practice, the radio effects continue between words until the session ends. Changes apply on the next playback.

## Answer with an external keyer

Expand **Answer with**, select **External keyer · Morse audio**, and start practice. Allow microphone access and place the microphone near the keyer’s speaker. Use a steady sidetone from **400–1200 Hz**, a quiet room, and headphones for the practice audio. Once playback finishes, key the call sign back. Correct calls advance automatically; incomplete or incorrect copies are checked after a pause and the same practice call is replayed.

This mode uses the wide-band [DeepCW model](https://github.com/e04/deepcw-engine) and ONNX Runtime Web in a dedicated worker, independently of Vosk. The model and runtime load only when keyer practice starts, approximately 26 MB before transfer compression. All assets are served from this site; microphone audio stays on the device. Browser HTTP caching may avoid repeat downloads. Microphone speech enhancement is disabled to preserve CW tones. Decoding is gated off during practice playback and feedback so the app does not score its own audio. Actual accuracy and silence detection depend on keyer volume, room noise, timing, and device performance.

## Develop and verify

Install Node.js 22 or newer and a current stable Rust toolchain.

```sh
rustup target add wasm32-unknown-unknown
cargo install --locked wasm-bindgen-cli --version 0.2.128
npm test
npm run build
python3 -m http.server 8000 --directory _site
```

Open http://localhost:8000/ to practice locally. Microphone and wake lock access require a secure context (HTTPS or localhost) and browser support.

The build verifies the bundled model hashes, compiles the locked Rust dependencies for WebAssembly, and packages the generated WebAssembly and loader with the static assets. Publish the contents of `_site/` together.

## GitHub Pages CI/CD

`.github/workflows/pages.yml` runs regression tests and the build for pull requests and pushes to `main`. Successful pushes to `main` automatically deploy `_site/` through GitHub Pages Actions. Manual deployment is available through **Actions → Test, build, and deploy Pages → Run workflow**. Pull requests only test and build.

The repository's Pages publishing source must be **GitHub Actions**. Deployment uses GitHub's built-in token and requires no saved secrets.

## Tests and browser verification

Run `npm test` for the Rust call generation, normalization, and timing tests and the JavaScript model transport tests. See [browser verification](tests/README.md) for the Leptos workflow and synthetic keyer tests.

## Third-party notices

Bundled Vosk components and the English model retain their Apache 2.0 license and attribution in `dist/vendor/NOTICE.txt` and `dist/vendor/LICENSE-APACHE-2.0.txt`. `scripts/patch-vosk.py` and `scripts/model-fetch-worker.js` preserve the original streaming model adapter. The original Sites hosting manifest was removed because GitHub Pages does not use it.

DeepCW model, metadata, and adapted decoder: e04/deepcw-engine commit `79104fbe1ea0abd09eb27c6ebf9c6bab364d0d7f`, MIT, with its license in `dist/vendor/LICENSE-DEEPCW.txt`. The browser adapter retains the upstream spectrogram normalization, CTC decoder, and posterior stitching; DFT trigonometry is cached for repeated windows. ONNX Runtime Web `1.22.0` is vendored from its npm distribution, with its MIT license and third-party notices in `dist/vendor/ort/`. `dist/models/deepcw-manifest.json` records provenance and asset hashes.
