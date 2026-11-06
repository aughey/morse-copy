# Morse Copy

Practice copying Morse call signs by ear, using voice or keyboard answers.

**Live app:** https://aughey.github.io/morse-copy/

## Source and behavior

The actual static HTML, CSS, JavaScript, vendored Vosk engine, and five speech-model parts were migrated from the Morse Copy Sites source repository. The original four source commits are retained in Git history. `dist/` is the editable application source, as in the original project; `_site/` is generated deployment output.

The migrated app source is formatted for readability and preserves:

- International call signs are included by default in a roughly even mix with U.S. calls. Turn **Include international call signs** off for U.S.-only practice; the choice is remembered, including across upgrades from older settings. Call sign format still controls prefix/suffix length. U.S. two-letter prefixes include AA–AL, with A/K/N/W initials sampled evenly. International practice uses a curated set of prefixes, including digit-leading examples such as 9A, 9H, and S5; generated calls are not a registry of assigned stations. Prefix references: [ARRL](https://www.arrl.org/international-call-sign-series), [RSGB](https://rsgb.org/main/operating/licensing-novs-visitors/international-prefixes/).
- Web Audio Morse playback, speed/spacing/tone controls, and feedback sounds.
- Optional HF static (filtered hiss and crackles), interference (nearby CW and a drifting carrier), and signal fading with a different strength on each playback. Expand **Radio environment** in Station settings; each effect has its own 0–100% control and defaults to off. Effects follow the volume setting, run during call sign playback including letter gaps, and stop when playback ends or practice is interrupted. Settings are remembered and apply to the next playback.
- On-device Vosk recognition, with Nancy/November mapping to N and Sugar/Sierra mapping to S. Saying “repeat” replays immediately, including during playback, without counting an attempt.
- Concurrent listening during Morse playback. A complete, correct spoken call sign scores immediately without waiting for silence, even during playback; other answers are scored after playback completes and speech settles.
- Screen wake lock during practice and model loading, release on completion/hide, and retry support.

All URLs are relative so assets and microphone worklets work under `/morse-copy/`. Voice initially downloads approximately 40 MB from the same site; the browser caches the extracted model. Speech audio is processed locally.

Radio effects set to 0 are omitted from the audio processing chain: no corresponding noise buffers, oscillators, filters, or fading automation are created. With all three at 0, Morse uses the direct clean-audio path. Changes apply on the next playback.

## Develop and verify

Requires Node.js 22 or newer. No npm dependencies or installation step are needed.

```sh
npm test
npm run build
python3 -m http.server 8000 --directory _site
```

Open http://localhost:8000/ to practice locally. Browser microphone and wake lock access require a secure context (HTTPS or localhost), browser support, and the applicable permissions. Device power settings can affect wake lock availability.

The build checks JavaScript syntax, relative HTML asset links, and every model part's size and SHA-256 before copying the original assets into `_site/`.

## GitHub Pages CI/CD

`.github/workflows/pages.yml` runs regression tests and the build for pull requests and pushes to `main`. Successful pushes to `main` automatically deploy `_site/` through GitHub Pages Actions. Manual deployment is available through **Actions → Test, build, and deploy Pages → Run workflow**. Pull requests only test and build.

The repository's Pages publishing source must be **GitHub Actions**. Deployment uses GitHub's built-in token and requires no saved secrets.

## Tests and browser verification

`tests/` covers recognition lifecycle, concurrent playback/capture, Nancy/November normalization, microphone cleanup, Morse timing, and wake lock lifecycle. Tests simulate browser APIs; actual microphone accuracy, audible playback, and device sleep behavior need a supported browser and real device. See `tests/README.md` for the original speech-engine integration harness.

## Third-party notices

Bundled Vosk components and the English model retain their Apache 2.0 license and attribution in `dist/vendor/NOTICE.txt` and `dist/vendor/LICENSE-APACHE-2.0.txt`. `scripts/patch-vosk.py` and `scripts/model-fetch-worker.js` preserve the original streaming model adapter. The original Sites hosting manifest was removed because GitHub Pages does not use it.
