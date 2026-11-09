use crate::detection;
use crate::session::{Session, VoiceStatus};
use crate::settings::Mode;
use leptos::prelude::*;

#[component]
pub(super) fn StationSettings(session: Session) -> impl IntoView {
    view! {
        <aside class="settings card">
            <div class="eyebrow">
                "MAKE IT YOUR FREQUENCY"
            </div>
            <h2>
                "Station settings"
            </h2>
            <PlaybackSettings session=session />
            <RadioEnvironment session=session />
            <CallSignSettings session=session />
            <AnswerModeSettings session=session />
        </aside>
    }
}

#[component]
fn PlaybackSettings(session: Session) -> impl IntoView {
    view! {
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
    }
}

#[component]
fn RadioEnvironment(session: Session) -> impl IntoView {
    view! {
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
    }
}

#[component]
fn CallSignSettings(session: Session) -> impl IntoView {
    view! {
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
    }
}

#[component]
fn AnswerModeSettings(session: Session) -> impl IntoView {
    let microphone_supported = detection::supported();

    view! {
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
    }
}
