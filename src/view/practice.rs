use crate::session::{Awake, Phase, Session, HIDDEN_CALL};
use crate::settings::Mode;
use leptos::prelude::*;

#[component]
pub(super) fn PracticeStation(session: Session) -> impl IntoView {
    view! {
        <section class="practice card">
            <div class="card-top">
                <span class="eyebrow">
                    "YOUR PRACTICE STATION"
                </span>
                <div class="station-badges">
                    <span id="modeBadge" class="pill">
                        {move || session.station.with(|s| {
                            if s.phase.words() { "RANDOM WORDS" }
                            else if s.spoken_words { "SPOKEN WORDS" }
                            else { session.settings.with(|settings| settings.mode.badge()) }
                        })}
                    </span>
                    <button id="wakeStatus" class="pill wake-status" type="button" aria-live="polite" prop:disabled=move || session.awake.get() != Awake::Retry data-state=move || session.awake.get().state() on:click=move |_| session.keep_awake()>
                        {move || session.awake.get().label()}
                    </button>
                </div>
            </div>
            <StationDisplay session=session />
            <PracticeActions session=session />
            <KeyboardAnswer session=session />
            <div class="station-foot">
                <span id="inputNote">
                    {move || session.station.with(|s| {
                        if s.phase.words() { "Continuous copy practice. Listen until you choose End practice." }
                        else if s.spoken_words { "Say the whole word or say “repeat” to hear it again." }
                        else { session.settings.with(|settings| settings.mode.note()) }
                    })}
                </span>
            </div>
        </section>
    }
}

#[component]
fn StationDisplay(session: Session) -> impl IntoView {
    view! {
        <div class="station" id="station">
            <div class="status">
                <span id="statusDot">
                </span>
                <span id="statusLabel">
                    {move || session.station.with(|s| {
                        let mode = if s.spoken_words { Mode::Voice } else { session.settings.with(|settings| settings.mode) };
                        s.phase.label(mode, s.spoken_words)
                    })}
                </span>
            </div>
            <div class="signal" id="signal" aria-hidden="true" class:active=move || session.station.with(|s| matches!(s.phase, Phase::Playing | Phase::Listening | Phase::PlayingWords))>
                {(0..31).map(|_| view! { <span></span> }).collect_view()}
            </div>
            <h2 id="headline">
                {move || session.station.with(|s| s.title)}
            </h2>
            <p id="instruction">
                {move || session.station.with(|s| s.instruction)}
            </p>
            <div class="call" id="call" hidden=move || session.station.with(|s| s.phase.words()) class:revealed=move || session.station.with(|s| s.revealed.is_some()) aria-label=move || session.station.with(|s| s.revealed.clone().unwrap_or_else(|| if s.spoken_words { "Word hidden".into() } else { "Call sign hidden".into() }))>
                {move || session.station.with(|s| s.revealed.clone().unwrap_or_else(|| HIDDEN_CALL.into()))}
            </div>
            <div id="feedback" role="status" aria-live="polite">
                {move || session.station.with(|s| s.feedback.clone())}
            </div>
        </div>
    }
}

#[component]
fn PracticeActions(session: Session) -> impl IntoView {
    let word_letters = RwSignal::new(String::new());

    view! {
        <form id="wordPractice" class="word-filter" hidden=move || session.station.with(|s| s.phase.active()) on:submit=move |ev: web_sys::SubmitEvent| {
            ev.prevent_default();
            let letters = word_letters.get_untracked();
            if ev.submitter().is_some_and(|button| button.id() == "startSpokenWords") {
                session.start_spoken_words(letters);
            } else {
                session.start_words(letters);
            }
        }>
            <label for="wordLetters">
                "Practice word letters (optional)"
            </label>
            <input id="wordLetters" placeholder="G, W, Q, P, X, Z" aria-describedby="wordLettersHint" autocomplete="off" autocapitalize="characters" spellcheck="false" on:input=move |ev| word_letters.set(event_target_value(&ev)) />
            <small id="wordLettersHint">
                "Every word will contain at least one of these letters. Leave blank for all words."
            </small>
        </form>
        <div class="actions">
            <button class="primary" id="start" hidden=move || session.station.with(|s| s.phase.active()) disabled=move || session.settings.with(|s| s.mode == Mode::Voice) && session.voice.with(|v| v.busy()) on:click=move |_| session.start()>
                "▶ Start practice"
            </button>
            <button class="secondary" id="startWords" type="submit" form="wordPractice" hidden=move || session.station.with(|s| s.phase.active())>
                "▶ Start random words"
            </button>
            <button class="secondary" id="startSpokenWords" type="submit" form="wordPractice" hidden=move || session.station.with(|s| s.phase.active()) disabled=move || session.voice.with(|v| v.busy())>
                "▶ Start spoken words"
            </button>
            <button class="secondary" id="replay" on:click=move |_| session.repeat() hidden=move || !session.station.with(|s| s.phase.can_replay())>
                "↻ Repeat"
            </button>
            <button class="text-button" id="reveal" on:click=move |_| session.reveal() hidden=move || !session.station.with(|s| s.phase.can_replay())>
                "Reveal"
            </button>
            <button class="text-button" id="pause" hidden=move || !session.station.with(|s| s.phase.active()) on:click=move |_| session.end()>
                "End practice"
            </button>
        </div>
    }
}

#[component]
fn KeyboardAnswer(session: Session) -> impl IntoView {
    let answer = NodeRef::<leptos::html::Input>::new();
    let typing = Memo::new(move |_| session.station.with(|s| s.phase == Phase::Typing));
    Effect::new(move |_| {
        if typing.get() {
            if let Some(input) = answer.get() {
                let _ = input.focus();
            }
        }
    });

    view! {
        <form id="answerForm" class="answer-form" hidden=move || session.station.with(|s| !s.phase.active() || s.phase.words() || s.spoken_words) || !session.settings.with(|s| s.mode == Mode::Keyboard) on:submit=move |ev| { ev.prevent_default(); session.check(&session.answer.get_untracked()); }>
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
    }
}

#[component]
pub(super) fn SessionStats(session: Session) -> impl IntoView {
    view! {
        <div class="stats card">
            <div class="eyebrow">
                "THIS SESSION"
            </div>
            <div class="stat-grid">
                <div>
                    <b id="correct">
                        {move || session.station.with(|s| s.score().correct)}
                    </b>
                    <span>
                        {move || session.station.with(|s| if s.spoken_words { "Words copied" } else { "Call signs copied" })}
                    </span>
                </div>
                <div>
                    <b id="accuracy">
                        {move || session.station.with(|s| {
                            let score = s.score();
                            if score.total == 0 { "—".into() } else { format!("{:.0}%", (100. * f64::from(score.correct) / f64::from(score.total)).round()) }
                        })}
                    </b>
                    <span>
                        "Accuracy"
                    </span>
                </div>
                <div>
                    <b id="streak">
                        {move || session.station.with(|s| s.score().streak)}
                    </b>
                    <span>
                        "Current streak"
                    </span>
                </div>
                <div>
                    <b id="maxStreak">
                        {move || session.station.with(|s| s.score().max_streak)}
                    </b>
                    <span>
                        "Maximum streak"
                    </span>
                </div>
            </div>
        </div>
    }
}
