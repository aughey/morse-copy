# Browser verification

Build with `npm run build` and serve `_site/` over localhost. Install Playwright and its Chromium browser locally.

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node tests/browser.cjs http://localhost:8000/
node tests/browser-keyer.cjs http://localhost:8000/
```

The first test exercises the Leptos station, keyboard scoring, settings persistence, radio effects, real model startup, and microphone cleanup. The second sends synthetic CW through a browser audio stream and checks automatic scoring with DeepCW.

The prior JavaScript app and its regression suite are available at the `pre-leptos` Git tag.
