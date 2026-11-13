use crate::settings::{preference, store};
use leptos::prelude::*;

const WELCOME_KEY: &str = "morse-copy-hide-welcome";

#[component]
pub(super) fn WelcomeDialog(welcome: NodeRef<leptos::html::Dialog>) -> impl IntoView {
    let hide_welcome = preference(WELCOME_KEY).as_deref() == Some("true");

    Effect::new(move |_| {
        if !hide_welcome {
            if let Some(dialog) = welcome.get() {
                let _ = dialog.show_modal();
            }
        }
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
    }
}

#[component]
pub(super) fn SiteHeader() -> impl IntoView {
    view! {
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
    }
}

#[component]
pub(super) fn Intro() -> impl IntoView {
    view! {
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
                    "Copy call signs, answer Morse words aloud, or listen to a continuous stream of random words."
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
    }
}

#[component]
pub(super) fn PracticeGuide() -> impl IntoView {
    view! {
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
    }
}

#[component]
pub(super) fn CompatibilityNotes() -> impl IntoView {
    view! {
        <details>
            <summary>
                "Voice compatibility & practice notes"
            </summary>
            <p>
                "Voice uses the Vosk small English model, running in a WebAssembly worker on your device. First use downloads about 40 MB from this site. The extracted model is cached in your browser when storage is available; clearing site data or browser storage eviction requires downloading again. No speech server is used and microphone audio is never uploaded. Voice requires microphone permission and a browser with WebAssembly and AudioWorklet support. Open the page in Safari or Chrome if an embedded browser does not offer microphone access."
            </p>
            <p>
                "Start spoken words plays one Morse word at a time. Say the whole word aloud. A correct copy scores as soon as it is recognized, and a different word is checked when you finish speaking. Say “repeat” for another listen without an attempt. Recognition uses the full practice word list, even when you filter the prompts by letter."
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
    }
}

#[component]
pub(super) fn SiteFooter(welcome: NodeRef<leptos::html::Dialog>) -> impl IntoView {
    view! {
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
