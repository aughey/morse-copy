use crate::detection;
use crate::session::{Awake, Phase, Session, VoiceStatus, HIDDEN_CALL};
use crate::settings::{preference, store, Mode};
use gloo_events::EventListener;
use leptos::prelude::*;

const WELCOME_KEY: &str = "morse-copy-hide-welcome";

pub fn app() -> impl IntoView {
    let session = Session::new();
    let microphone_supported = detection::supported();
    let hide_welcome = preference(WELCOME_KEY).as_deref() == Some("true");
    let welcome = NodeRef::<leptos::html::Dialog>::new();
    let answer = NodeRef::<leptos::html::Input>::new();

    Effect::new(move |_| {
        if !hide_welcome {
            if let Some(dialog) = welcome.get() {
                let _ = dialog.show_modal();
            }
        }
    });
    let typing = Memo::new(move |_| session.station.with(|s| s.phase == Phase::Typing));
    Effect::new(move |_| {
        if typing.get() {
            if let Some(input) = answer.get() {
                let _ = input.focus();
            }
        }
    });

    let window = web_sys::window().unwrap();
    let document = window.document().unwrap();
    let visibility = EventListener::new(&document.clone(), "visibilitychange", move |_| {
        if document.hidden() {
            session.end();
        }
        session.keep_awake();
    });
    let page_hide = EventListener::new(&window, "pagehide", move |_| session.end());
    let focus = EventListener::new(&window, "focus", move |_| session.keep_awake());
    // The component owns these listeners for the lifetime of the mounted app.
    let listeners = StoredValue::new_local([visibility, page_hide, focus]);
    on_cleanup(move || {
        listeners.dispose();
    });

    view! {
        <dialog id="welcome" class="welcome" aria-labelledby="welcomeTitle" aria-describedby="welcomeDescription" node_ref=welcome>
            <div class="eyebrow">
                "WELCOME TO MORSE COPY"
            </div>
            <h2 id="welcomeTitle" tabindex="-1">
                "Your ears, your voice,"
                <br />
                "and a pencil."
            </h2>
            <p id="welcomeDescription">
                "Practice copying Morse call signs with a pen or pencil and paper. Speak your answers so you can keep your eyes on your copy."
            </p>
            <ol class="welcome-steps">
                <li>
                    <strong>
                        "Set up your station."
                    </strong>
                    " Choose your character and effective speeds, audio settings, and call sign format. Leave "
                    <b>
                        "Answer with"
                    </b>
                    " set to "
                    <b>
                        "Voice"
                    </b>
                    "."
                </li>
                <li>
                    <strong>
                        "Click Start practice."
                    </strong>
                    " Allow microphone access when asked. Listen to the call sign in Morse and write it on your paper."
                </li>
                <li>
                    <strong>
                        "Say the call sign aloud."
                    </strong>
                    " You can use letters, numbers, and phonetic words, or mix them. For example, say “K one A B C” or “Kilo one Alpha Bravo Charlie.” Use phonetic spelling to help voice recognition distinguish letters that sound alike."
                </li>
            </ol>
            <p>
                "Prefer to send your answer in Morse? Choose "
                <b>
                    "External keyer · Morse audio"
                </b>
                " under "
                <b>
                    "Answer with"
                </b>
                ". Place the microphone near your keyer’s speaker and send the call sign after playback ends. Correct copies advance automatically; a pause checks other copies. Voice and Keyboard remain separate options."
            </p>
            <p>
                "A happy sound means you got it right, and the next call sign follows automatically. A different tone means try again, and the same call sign plays again."
            </p>
            <p class="welcome-repeat">
                "Need another listen? Say "
                <strong>
                    "“repeat”"
                </strong>
                " to replay the call sign immediately, even while it’s playing. No typing needed."
            </p>
            <p>
                "Practice and voice recognition run entirely in your web browser. Your microphone audio and spoken answers stay on your device and are never sent to a server."
            </p>
            <form method="dialog" class="welcome-actions">
                <label class="welcome-preference">
                    <input type="checkbox" id="hideWelcome" prop:checked=hide_welcome on:change=move |ev| store(WELCOME_KEY, if event_target_checked(&ev) { "true" } else { "false" }) />
                    " Don’t show this again"
                </label>
                <button class="primary" type="submit">
                    "Set up practice"
                </button>
            </form>
        </dialog>
        <header>
            <a class="brand" href="./">
                <span class="brand-icon">
                    "·−"
                </span>
                "MORSE COPY"
            </a>
            <span class="header-note">
                "A little practice. A better ear."
            </span>
            <span class="tag">
                "CW TRAINER"
            </span>
        </header>
        <main>
            <section class="intro">
                <div>
                    <div class="eyebrow">
                        "TUNE IN. COPY. REPEAT."
                    </div>
                    <h1>
                        "Good copy starts"
                        <br />
                        "with a little listening."
                    </h1>
                    <p>
                        "Hear a call sign. Copy it back. Find your rhythm."
                    </p>
                </div>
                <div class="intro-art" aria-hidden="true">
                    <svg viewbox="0 0 280 130">
                        <g fill="none" stroke="currentColor" stroke-width="1">
                            <path d="M14 91h252M80 80a60 60 0 0 1 120 0M60 80a80 80 0 0 1 160 0M40 80a100 100 0 0 1 200 0" opacity=".22" />
                            <path d="M140 28v64m-10-20 10-16 10 16m-27 20h34" stroke-width="2" />
                            <path d="M30 112h8m9 0h25m10 0h8m20 0h25m9 0h8m9 0h8m20 0h8m9 0h25m9 0h8" stroke-width="4" />
                        </g>
                    </svg>
                    <span>
                        "LISTEN FOR THE POSSIBILITIES"
                    </span>
                </div>
            </section>
            <div class="workspace">
                <section class="practice card">
                    <div class="card-top">
                        <span class="eyebrow">
                            "YOUR PRACTICE STATION"
                        </span>
                        <div class="station-badges">
                            <span id="modeBadge" class="pill">
                                {move || session.settings.with(|s| s.mode.badge())}
                            </span>
                            <button id="wakeStatus" class="pill wake-status" type="button" aria-live="polite" prop:disabled=move || session.awake.get() != Awake::Retry data-state=move || session.awake.get().state() on:click=move |_| session.keep_awake()>
                                {move || session.awake.get().label()}
                            </button>
                        </div>
                    </div>
                    <div class="station" id="station">
                        <div class="status">
                            <span id="statusDot">
                            </span>
                            <span id="statusLabel">
                                {move || session.station.with(|s| s.phase.label(session.settings.with(|settings| settings.mode)))}
                            </span>
                        </div>
                        <div class="signal" id="signal" aria-hidden="true" class:active=move || session.station.with(|s| matches!(s.phase, Phase::Playing | Phase::Listening))>
                            {(0..31).map(|_| view! { <span></span> }).collect_view()}
                        </div>
                        <h2 id="headline">
                            {move || session.station.with(|s| s.title)}
                        </h2>
                        <p id="instruction">
                            {move || session.station.with(|s| s.instruction)}
                        </p>
                        <div class="call" id="call" class:revealed=move || session.station.with(|s| s.revealed.is_some()) aria-label=move || session.station.with(|s| s.revealed.clone().unwrap_or_else(|| "Call sign hidden".into()))>
                            {move || session.station.with(|s| s.revealed.clone().unwrap_or_else(|| HIDDEN_CALL.into()))}
                        </div>
                        <div id="feedback" role="status" aria-live="polite">
                            {move || session.station.with(|s| s.feedback.clone())}
                        </div>
                    </div>
                    <div class="actions">
                        <button class="primary" id="start" hidden=move || session.station.with(|s| s.phase.active()) disabled=move || session.settings.with(|s| s.mode == Mode::Voice) && session.voice.with(|v| v.busy()) on:click=move |_| session.start()>
                            "▶ Start practice"
                        </button>
                        <button class="secondary" id="replay" on:click=move |_| session.repeat() hidden=move || session.station.with(|s| !s.phase.active() || s.phase == Phase::Loading)>
                            "↻ Repeat"
                        </button>
                        <button class="text-button" id="reveal" on:click=move |_| session.reveal() hidden=move || session.station.with(|s| !s.phase.active() || s.phase == Phase::Loading)>
                            "Reveal"
                        </button>
                        <button class="text-button" id="pause" hidden=move || !session.station.with(|s| s.phase.active()) on:click=move |_| session.end()>
                            "End practice"
                        </button>
                    </div>
                    <form id="answerForm" class="answer-form" hidden=move || !session.station.with(|s| s.phase.active()) || !session.settings.with(|s| s.mode == Mode::Keyboard) on:submit=move |ev| { ev.prevent_default(); session.check(&session.answer.get_untracked()); }>
                        <label for="answer">
                            "Your copy"
                        </label>
                        <div>
                            <input id="answer" placeholder="e.g. K1ABC" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="30" node_ref=answer prop:value=move || session.answer.get() on:input=move |ev| session.answer.set(event_target_value(&ev)) disabled=move || session.station.with(|s| s.phase != Phase::Typing) />
                            <button type="submit" class="secondary" id="submit" disabled=move || session.station.with(|s| s.phase != Phase::Typing)>
                                "Check ↵"
                            </button>
                        </div>
                    </form>
                    <div class="station-foot">
                        <span id="inputNote">
                            {move || session.settings.with(|s| s.mode.note())}
                        </span>
                    </div>
                </section>
                <aside class="settings card">
                    <div class="eyebrow">
                        "MAKE IT YOUR FREQUENCY"
                    </div>
                    <h2>
                        "Station settings"
                    </h2>
                    <label class="control-label" for="speed">
                        "Character speed"
                        <b>
                            <span id="speedValue">
                                {move || session.settings.with(|s| s.range("speed"))}
                            </span>
                            <small>
                                "WPM"
                            </small>
                        </b>
                    </label>
                    <input type="range" id="speed" min="5" max="40" prop:value=move || session.settings.with(|s| s.range("speed").to_string()) on:input=move |ev| { if let Ok(value) = event_target_value(&ev).parse() { session.range("speed", value); } } />
                    <div class="range-label">
                        <span>
                            "5 WPM"
                        </span>
                        <span>
                            "40 WPM"
                        </span>
                    </div>
                    <label class="control-label" for="spacing">
                        "Effective speed"
                        <b>
                            <span id="spacingValue">
                                {move || session.settings.with(|s| s.range("spacing"))}
                            </span>
                            <small>
                                "WPM"
                            </small>
                        </b>
                    </label>
                    <input type="range" id="spacing" min="5" prop:value=move || session.settings.with(|s| s.range("spacing").to_string()) on:input=move |ev| { if let Ok(value) = event_target_value(&ev).parse() { session.range("spacing", value); } } max=move || session.settings.with(|s| s.speed) />
                    <p class="hint">
                        "Extra space between letters. More time to think."
                    </p>
                    <label class="control-label" for="tone">
                        "Sidetone"
                        <b>
                            <span id="toneValue">
                                {move || session.settings.with(|s| s.range("tone"))}
                            </span>
                            <small>
                                "Hz"
                            </small>
                        </b>
                    </label>
                    <input type="range" id="tone" min="350" max="900" step="25" prop:value=move || session.settings.with(|s| s.range("tone").to_string()) on:input=move |ev| { if let Ok(value) = event_target_value(&ev).parse() { session.range("tone", value); } } />
                    <label class="control-label" for="volume">
                        "Volume"
                        <b>
                            <span id="volumeValue">
                                {move || session.settings.with(|s| s.range("volume"))}
                            </span>
                            <small>
                                "%"
                            </small>
                        </b>
                    </label>
                    <input type="range" id="volume" min="0" max="100" prop:value=move || session.settings.with(|s| s.range("volume").to_string()) on:input=move |ev| { if let Ok(value) = event_target_value(&ev).parse() { session.range("volume", value); } } />
                    <details class="radio-settings">
                        <summary>
                            "Radio environment · optional"
                        </summary>
                        <label class="control-label" for="staticLevel">
                            "HF static"
                            <b>
                                <span id="staticLevelValue">
                                    {move || session.settings.with(|s| s.range("staticLevel"))}
                                </span>
                                <small>
                                    "%"
                                </small>
                            </b>
                        </label>
                        <input type="range" id="staticLevel" min="0" max="100" prop:value=move || session.settings.with(|s| s.range("staticLevel").to_string()) on:input=move |ev| { if let Ok(value) = event_target_value(&ev).parse() { session.range("staticLevel", value); } } />
                        <label class="control-label" for="interference">
                            "Interference"
                            <b>
                                <span id="interferenceValue">
                                    {move || session.settings.with(|s| s.range("interference"))}
                                </span>
                                <small>
                                    "%"
                                </small>
                            </b>
                        </label>
                        <input type="range" id="interference" min="0" max="100" prop:value=move || session.settings.with(|s| s.range("interference").to_string()) on:input=move |ev| { if let Ok(value) = event_target_value(&ev).parse() { session.range("interference", value); } } />
                        <label class="control-label" for="fading">
                            "Signal fading"
                            <b>
                                <span id="fadingValue">
                                    {move || session.settings.with(|s| s.range("fading"))}
                                </span>
                                <small>
                                    "%"
                                </small>
                            </b>
                        </label>
                        <input type="range" id="fading" min="0" max="100" prop:value=move || session.settings.with(|s| s.range("fading").to_string()) on:input=move |ev| { if let Ok(value) = event_target_value(&ev).parse() { session.range("fading", value); } } />
                        <p class="hint">
                            "Hiss and static crashes, nearby CW and a wandering carrier, and changing signal strength. All at 0 gives clean audio. Applies to the next playback."
                        </p>
                    </details>
                    <details class="radio-settings">
                        <summary>
                            "Call sign format"
                        </summary>
                        <div class="select-row">
                            <label for="includeInternational">
                                "Include international call signs"
                            </label>
                            <select id="includeInternational" aria-describedby="internationalHint" prop:value=move || session.settings.with(|s| if s.international { "yes" } else { "no" }) on:change=move |ev| session.change(|s| s.international = event_target_value(&ev) == "yes")>
                                <option value="yes">
                                    "On · US + international"
                                </option>
                                <option value="no">
                                    "Off · US only"
                                </option>
                            </select>
                        </div>
                        <p class="hint" id="internationalHint">
                            "Practice a roughly even mix of US and international prefixes. Applies to the next call sign."
                        </p>
                        <div class="select-row">
                            <label for="format">
                                "Call sign format"
                            </label>
                            <select id="format" aria-describedby="formatHint" prop:value=move || session.settings.with(|s| s.format.clone()) on:change=move |ev| session.change(|s| s.format = event_target_value(&ev))>
                                <optgroup label="Standard formats">
                                    <option value="mixed">
                                        "Mixed formats"
                                    </option>
                                    <option value="short">
                                        "1 × 2 · K1AB"
                                    </option>
                                    <option value="long">
                                        "1 × 3 · W1ABC"
                                    </option>
                                    <option value="two">
                                        "2 × 3 · KA1ABC"
                                    </option>
                                </optgroup>
                                <optgroup label="Head-copy practice · maximum letters">
                                    <option value="practice-1-1">
                                        "1 × 1 · K1A"
                                    </option>
                                    <option value="practice-1-2">
                                        "1 × 1–2 · K1A / K1AB"
                                    </option>
                                    <option value="practice-1-3">
                                        "1 × 1–3 · K1A … K1ABC"
                                    </option>
                                    <option value="practice-2-1">
                                        "1–2 × 1 · K1A / KA1B"
                                    </option>
                                    <option value="practice-2-2">
                                        "1–2 × 1–2 · K1A … KA1BC"
                                    </option>
                                    <option value="practice-2-3">
                                        "1–2 × 1–3 · K1A … KA1BCD"
                                    </option>
                                </optgroup>
                            </select>
                        </div>
                        <p class="hint" id="formatHint">
                            "Head-copy practice varies from one letter up to each selected maximum, before and after a single digit. Start with 1 × 1 and hold the whole call in your head, then answer aloud. These practice calls may not be assigned call sign formats. Applies to the next call sign."
                        </p>
                    </details>
                    <details class="radio-settings">
                        <summary>
                            "Answer with · "
                            <span id="answerSummary">
                                {move || session.settings.with(|s| s.mode.title())}
                            </span>
                        </summary>
                        <div class="select-row">
                            <label for="inputMode">
                                "Answer with"
                            </label>
                            <select id="inputMode" prop:value=move || session.settings.with(|s| s.mode.value()) on:change=move |ev| session.change_mode(Mode::from_value(&event_target_value(&ev)))>
                                <option value="voice" disabled={!microphone_supported}>
                                    "Voice"
                                </option>
                                <option value="type">
                                    "Keyboard"
                                </option>
                                <option value="keyer" disabled={!microphone_supported}>
                                    "External keyer · Morse audio"
                                </option>
                            </select>
                        </div>
                        <p class="hint" id="keyerInfo" hidden=move || session.settings.with(|s| s.mode != Mode::Keyer)>
                            "Place the computer microphone near your external keyer’s speaker. After practice playback ends, send the call sign in Morse. A correct copy scores as soon as it is decoded; otherwise a pause of about 1.8 seconds triggers a check. Use a keyer tone between 400 and 1200 Hz. DeepCW decodes locally; first use loads about 26 MB, independently of voice. Each answer has a 60-second limit. Use headphones for practice audio and a quiet room."
                        </p>
                        <div class="voice-box" id="voiceBox" hidden=move || session.settings.with(|s| s.mode != Mode::Voice)>
                            <span id="voiceIcon">
                                "◉"
                            </span>
                            <div>
                                <strong id="voiceTitle">
                                    {move || session.voice.with(|v| v.title())}
                                </strong>
                                <p id="voiceInfo">
                                    {move || session.voice.with(|v| v.info())}
                                </p>
                                <button id="install" class="text-button" hidden=move || session.voice.with(|v| matches!(v, VoiceStatus::Ready)) disabled=move || session.voice.with(|v| v.busy()) || session.station.with(|s| s.phase.active()) on:click=move |_| session.preload_voice()>
                                    "Load local voice · about 40 MB"
                                </button>
                            </div>
                        </div>
                    </details>
                </aside>
            </div>
            <section class="bottom">
                <div class="stats card">
                    <div class="eyebrow">
                        "THIS SESSION"
                    </div>
                    <div class="stat-grid">
                        <div>
                            <b id="correct">
                                {move || session.station.with(|s| s.score.correct)}
                            </b>
                            <span>
                                "Call signs copied"
                            </span>
                        </div>
                        <div>
                            <b id="accuracy">
                                {move || session.station.with(|s| if s.score.total == 0 { "—".into() } else { format!("{:.0}%", (100. * f64::from(s.score.correct) / f64::from(s.score.total)).round()) })}
                            </b>
                            <span>
                                "Accuracy"
                            </span>
                        </div>
                        <div>
                            <b id="streak">
                                {move || session.station.with(|s| s.score.streak)}
                            </b>
                            <span>
                                "Current streak"
                            </span>
                        </div>
                    </div>
                </div>
                <div class="how card">
                    <div class="eyebrow">
                        "THE RHYTHM IS SIMPLE"
                    </div>
                    <div class="steps">
                        <span>
                            <i>
                                "01"
                            </i>
                            " Listen closely"
                        </span>
                        <span>
                            <i>
                                "02"
                            </i>
                            " Answer your copy"
                        </span>
                        <span>
                            <i>
                                "03"
                            </i>
                            " Keep going"
                        </span>
                    </div>
                    <p>
                        "A ding means you got it. A dong means another listen."
                        <br />
                        "Say “K one A B C” or “Kilo one Alpha Bravo Charlie.” Mix letters, numbers, and phonetic words as needed. Phonetic spelling helps voice recognition distinguish letters that sound alike. Everything runs in your browser; your audio and spoken answers are never sent to a server."
                    </p>
                </div>
            </section>
            <details>
                <summary>
                    "Voice compatibility & practice notes"
                </summary>
                <p>
                    "Voice uses the Vosk small English model, running in a WebAssembly worker on your device. First use downloads about 40 MB from this site. The extracted model is cached in your browser when storage is available; clearing site data or browser storage eviction requires downloading again. No speech server is used and microphone audio is never uploaded. Voice requires microphone permission and a browser with WebAssembly and AudioWorklet support. Open the page in Safari or Chrome if an embedded browser does not offer microphone access."
                </p>
                <p>
                    "The microphone stays connected during a voice session so practice can continue hands-free. Recognition listens while the Morse code plays and during your answer afterwards. Speak the letters as you hear them or wait until playback ends. Your answer is checked after the Morse finishes, so pauses between letters during playback are allowed. Ending the session, switching tabs, or leaving the page stops the microphone. Both “Nancy” and “November” mean the letter N; “Sugar” and “Sierra” mean S. Say “repeat” to replay immediately, even during Morse playback, without counting an attempt. After playback, finish your call sign in one phrase. You can mix letters, numbers, and phonetic words. Use phonetic spelling to help voice recognition distinguish similar-sounding letters. If nothing is heard within 18 seconds after playback, tap Repeat to try again without a penalty."
                </p>
                <p>
                    "The screen stays awake automatically during practice and model loading when supported by your browser. The station shows “Screen stays awake” while the lock is held. If you see “Keep awake · retry,” tap it to request the lock again; your device’s power-saving settings may need adjusting. Ending the session restores normal screen sleep. Keep this page visible; switching apps or manually locking the screen pauses practice."
                </p>
                <p>
                    "Use headphones for clearer recognition while Morse plays, and keep this page in the foreground. These are randomly generated US and international-style practice call signs, not a registry of assigned stations. Settings apply to the next playback. Revealing a call sign counts as a miss."
                </p>
                <p>
                    "Speech engine and model: Vosk / Alpha Cephei."
                    <a href="vendor/NOTICE.txt">
                        "Open-source notices"
                    </a>
                    "·"
                    <a href="vendor/LICENSE-APACHE-2.0.txt">
                        "Apache 2.0 license"
                    </a>
                </p>
                <p>
                    "External keyer mode uses "
                    <a href="https://github.com/e04/deepcw-engine">
                        "DeepCW"
                    </a>
                    "with ONNX Runtime Web, running on this device. The microphone is connected during the session but Morse decoding starts only after playback ends, and stops during feedback and repeat playback. It does not load or use the speech model. A complete correct call sign scores immediately when decoded. Other answers are checked after about 1.8 seconds without keyer tones or new decoded letters. Long pauses can submit a partial answer; keep the call sign together. Ending practice, hiding the page, or changing answer mode releases the microphone."
                    <a href="vendor/LICENSE-DEEPCW.txt">
                        "DeepCW license"
                    </a>
                    " · "
                    <a href="vendor/ort/LICENSE.txt">
                        "ONNX Runtime license"
                    </a>
                </p>
            </details>
        </main>
        <footer>
            <span>
                "·− MORSE COPY"
            </span>
            <button type="button" id="showWelcome" class="text-button" on:click=move |_| { if let Some(dialog) = welcome.get() { let _ = dialog.show_modal(); } }>
                "How to practice"
            </button>
            <span>
                "Train your ear. Trust your copy. 73."
            </span>
        </footer>
    }
}
