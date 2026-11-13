use crate::{
    audio::{self, Playback},
    detection::{self, DeepCw, Engine, Microphone, Model, Output},
    morse,
    settings::{Mode, Settings},
    words::WordDeck,
};
use futures::future::{AbortHandle, Abortable};
use gloo_events::EventListener;
use gloo_timers::future::TimeoutFuture;
use js_sys::{Math, Reflect};
use leptos::prelude::*;
use std::{cell::RefCell, rc::Rc};
use wasm_bindgen::{prelude::*, JsCast};
use wasm_bindgen_futures::{spawn_local, JsFuture};
use web_sys::{AudioContext, EventTarget};

#[wasm_bindgen]
extern "C" {
    type WakeLock;
    #[wasm_bindgen(method)]
    fn request(this: &WakeLock, kind: &str) -> js_sys::Promise;

    #[wasm_bindgen(extends = EventTarget)]
    type WakeLockSentinel;
    #[wasm_bindgen(method, getter)]
    fn released(this: &WakeLockSentinel) -> bool;
    #[wasm_bindgen(method)]
    fn release(this: &WakeLockSentinel) -> js_sys::Promise;
}

pub const HIDDEN_CALL: &str = "· · ·   − − −   · · ·";
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Idle,
    Loading,
    Playing,
    LoadingWords,
    PlayingWords,
    Listening,
    Typing,
    Feedback,
    Revealed,
    Paused,
}

impl Phase {
    pub fn active(self) -> bool {
        !matches!(self, Self::Idle | Self::Paused)
    }
    pub fn words(self) -> bool {
        matches!(self, Self::LoadingWords | Self::PlayingWords)
    }
    pub fn can_replay(self) -> bool {
        self.active() && !self.words() && self != Self::Loading
    }
    pub fn label(self, mode: Mode, spoken_words: bool) -> &'static str {
        match self {
            Self::Idle => "Standing by",
            Self::Loading => match mode {
                Mode::Keyer => "Preparing local Morse decoder",
                Mode::Voice => "Preparing local voice",
                Mode::Keyboard => "Preparing practice audio",
            },
            Self::Playing => {
                if mode == Mode::Voice {
                    "Playing + listening"
                } else {
                    "Receiving Morse"
                }
            }
            Self::LoadingWords => "Loading the word list",
            Self::PlayingWords => "Receiving Morse",
            Self::Listening => "Your turn · listening",
            Self::Typing => "Your turn · copy",
            Self::Feedback => "Copy checked",
            Self::Revealed if spoken_words => "Word revealed",
            Self::Revealed => "Call sign revealed",
            Self::Paused => "Session paused",
        }
    }
}

#[derive(Default, Clone, Copy)]
pub struct Score {
    pub correct: u32,
    pub total: u32,
    pub streak: u32,
    pub max_streak: u32,
}

#[derive(Clone)]
pub struct Station {
    pub phase: Phase,
    pub title: &'static str,
    pub instruction: &'static str,
    pub feedback: String,
    pub revealed: Option<String>,
    pub spoken_words: bool,
    call_score: Score,
    word_score: Score,
}

impl Station {
    pub fn score(&self) -> &Score {
        if self.spoken_words {
            &self.word_score
        } else {
            &self.call_score
        }
    }

    fn score_mut(&mut self) -> &mut Score {
        if self.spoken_words {
            &mut self.word_score
        } else {
            &mut self.call_score
        }
    }
}

#[derive(Clone)]
pub enum VoiceStatus {
    Available,
    Loading,
    Progress(u32),
    Ready,
    Failed(String),
}

impl VoiceStatus {
    pub fn busy(&self) -> bool {
        matches!(self, Self::Loading | Self::Progress(_))
    }

    pub fn title(&self) -> String {
        match self {
            Self::Available => "Local voice · model ready to load".into(),
            Self::Loading => "Loading local voice…".into(),
            Self::Progress(percent) => format!("Downloading model · {percent}%"),
            Self::Ready => "Vosk ready · running on this device".into(),
            Self::Failed(_) => "Voice setup needs another try".into(),
        }
    }

    pub fn info(&self) -> String {
        match self {
            Self::Available => {
                "First use downloads about 40 MB. Recognition runs on this device.".into()
            }
            Self::Loading => "Restoring the cached model, or downloading it on first use.".into(),
            Self::Progress(100) => "Download complete. Preparing local recognition…".into(),
            Self::Progress(_) => "One-time download, about 40 MB. Keep this page open.".into(),
            Self::Ready => "Recognizes call signs and practice words locally.".into(),
            Self::Failed(message) => message.clone(),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Awake {
    Idle,
    Requesting,
    Locked,
    Retry,
    Unsupported,
}

impl Awake {
    pub fn label(self) -> &'static str {
        match self {
            Self::Idle => "Screen sleep allowed",
            Self::Requesting => "Keeping screen awake…",
            Self::Locked => "Screen stays awake",
            Self::Retry => "Keep awake · retry",
            Self::Unsupported => "Keep awake unavailable",
        }
    }

    pub fn state(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Requesting => "requesting",
            Self::Locked => "locked",
            Self::Retry => "blocked",
            Self::Unsupported => "unsupported",
        }
    }
}

#[derive(Default)]
struct Runtime {
    ctx: Option<AudioContext>,
    playback: Option<Playback>,
    word_radio: Playback,
    mic: Option<Rc<Microphone>>,
    voice: Option<Rc<Model>>,
    keyer: Option<Rc<DeepCw>>,
    pending: Option<AbortHandle>,
    words: Option<WordDeck>,
    word_grammar: Option<String>,
    epoch: u32,
    prompt: String,
    attempted: bool,
    lock: Option<(WakeLockSentinel, EventListener)>,
    lock_pending: bool,
}

#[derive(Clone, Copy)]
pub struct Session {
    pub station: RwSignal<Station>,
    pub settings: RwSignal<Settings>,
    pub answer: RwSignal<String>,
    pub voice: RwSignal<VoiceStatus>,
    pub awake: RwSignal<Awake>,
    runtime: StoredValue<Rc<RefCell<Runtime>>, LocalStorage>,
}

impl Session {
    pub fn new() -> Self {
        let settings = Settings::load();
        Self {
            station: RwSignal::new(Station {
                phase: Phase::Idle,
                title: "Ready when you are.",
                instruction: settings.mode.welcome(),
                feedback: "Your next good copy is one listen away.".into(),
                revealed: None,
                spoken_words: false,
                call_score: Score::default(),
                word_score: Score::default(),
            }),
            settings: RwSignal::new(settings),
            answer: RwSignal::new(String::new()),
            voice: RwSignal::new(VoiceStatus::Available),
            awake: RwSignal::new(Awake::Idle),
            runtime: StoredValue::new_local(Rc::new(RefCell::new(Runtime::default()))),
        }
    }

    fn runtime(self) -> Rc<RefCell<Runtime>> {
        self.runtime.get_value()
    }
    fn phase(self) -> Phase {
        self.station.with_untracked(|s| s.phase)
    }
    fn mode(self) -> Mode {
        if self.spoken_words() {
            Mode::Voice
        } else {
            self.settings.with_untracked(|s| s.mode)
        }
    }
    fn spoken_words(self) -> bool {
        self.station.with_untracked(|s| s.spoken_words)
    }

    fn display(
        self,
        phase: Phase,
        title: &'static str,
        instruction: &'static str,
        feedback: impl Into<String>,
    ) {
        self.station.update(|s| {
            s.phase = phase;
            s.title = title;
            s.instruction = instruction;
            s.feedback = feedback.into();
        });
    }

    pub fn change(self, update: impl FnOnce(&mut Settings)) {
        self.settings.update(|settings| {
            update(settings);
            settings.save();
        });
    }

    pub fn range(self, key: &str, value: f64) {
        self.change(|s| {
            *s.range_mut(key) = value;
            s.spacing = s.spacing.min(s.speed);
        });
    }

    pub fn change_mode(self, mode: Mode) {
        self.change(|s| s.mode = mode);
        let phase = self.phase();
        if phase.active() && !phase.words() && !self.spoken_words() {
            self.end();
            self.feedback("Answer mode changed. Press Start practice to begin.");
        } else if phase == Phase::Idle {
            self.station.update(|s| s.instruction = mode.welcome());
        }
    }

    fn feedback(self, message: impl Into<String>) {
        self.station.update(|s| s.feedback = message.into());
    }

    fn invalidate(self) -> u32 {
        let runtime = self.runtime();
        let mut state = runtime.borrow_mut();
        state.epoch = state.epoch.wrapping_add(1);
        state.playback = None;
        state.word_radio = Playback::default();
        if let Some(mic) = &state.mic {
            mic.active(None);
        }
        if let Some(pending) = state.pending.take() {
            pending.abort();
        }
        state.epoch
    }

    fn valid(self, token: u32) -> bool {
        self.runtime().borrow().epoch == token
    }

    fn new_prompt(self) {
        let settings = self.settings.get_untracked();
        let runtime = self.runtime();
        let mut state = runtime.borrow_mut();
        if self.spoken_words() {
            state.prompt = state.words.as_mut().unwrap().draw().into();
        } else {
            loop {
                let call = morse::generate(&settings.format, settings.international, |n| {
                    (Math::random() * n as f64) as usize
                });
                if call != state.prompt {
                    state.prompt = call;
                    break;
                }
            }
        }
        state.attempted = false;
    }

    fn ctx(self) -> Result<AudioContext, JsValue> {
        let runtime = self.runtime();
        let mut state = runtime.borrow_mut();
        if let Some(ctx) = &state.ctx {
            return Ok(ctx.clone());
        }
        let ctx = AudioContext::new()?;
        state.ctx = Some(ctx.clone());
        Ok(ctx)
    }

    pub fn end(self) {
        let phase = self.phase();
        if !phase.active() {
            return;
        }
        self.invalidate();
        self.runtime().borrow_mut().mic = None;
        if phase.words() {
            audio::set_session_type("auto");
        }
        self.display(
            Phase::Paused,
            "A good place to pause.",
            if phase.words() {
                "Press Start random words whenever you’re ready to copy again."
            } else if self.spoken_words() {
                "Press Start spoken words whenever you’re ready to copy again."
            } else {
                "Your session stats stay here. Start again whenever you like."
            },
            "73. See you on the next frequency.",
        );
        self.keep_awake();
    }

    pub fn keep_awake(self) {
        let window = web_sys::window().unwrap();
        let navigator = window.navigator();
        let visible = !window.document().unwrap().hidden();
        let needed = visible && (self.phase().active() || self.voice.get_untracked().busy());
        let runtime = self.runtime();
        if !needed {
            if let Some((lock, _listener)) = runtime.borrow_mut().lock.take() {
                let _ = lock.release();
            }
            self.awake.set(Awake::Idle);
            return;
        }
        let Some(wake_lock) = Reflect::get(&navigator, &"wakeLock".into())
            .ok()
            .filter(|value| !value.is_undefined())
        else {
            self.awake.set(Awake::Unsupported);
            return;
        };
        {
            let mut state = runtime.borrow_mut();
            if state.lock_pending
                || state
                    .lock
                    .as_ref()
                    .is_some_and(|(lock, _)| !lock.released())
            {
                return;
            }
            state.lock_pending = true;
        }
        self.awake.set(Awake::Requesting);
        spawn_local(async move {
            let result =
                JsFuture::from(wake_lock.unchecked_into::<WakeLock>().request("screen")).await;
            runtime.borrow_mut().lock_pending = false;
            if !window.document().unwrap().hidden()
                && (self.phase().active() || self.voice.get_untracked().busy())
            {
                match result {
                    Ok(value) => {
                        let lock: WakeLockSentinel = value.unchecked_into();
                        let listener = EventListener::new(&lock, "release", move |_| {
                            self.awake.set(Awake::Retry)
                        });
                        self.awake.set(Awake::Locked);
                        runtime.borrow_mut().lock = Some((lock, listener));
                    }
                    Err(_) => self.awake.set(Awake::Retry),
                }
            } else if let Ok(value) = result {
                let _ = value.unchecked_into::<WakeLockSentinel>().release();
            }
        });
    }

    async fn voice_model(self) -> Result<Rc<Model>, JsValue> {
        let runtime = self.runtime();
        if let Some(model) = runtime
            .borrow()
            .voice
            .as_ref()
            .filter(|model| model.ready())
        {
            return Ok(model.clone());
        }
        self.voice.set(VoiceStatus::Loading);
        self.keep_awake();
        let result =
            detection::load_voice(move |percent| self.voice.set(VoiceStatus::Progress(percent)))
                .await;
        let result = match result {
            Ok(model) => {
                let model = Rc::new(model);
                runtime.borrow_mut().voice = Some(model.clone());
                self.voice.set(VoiceStatus::Ready);
                Ok(model)
            }
            Err(error) => {
                self.voice
                    .set(VoiceStatus::Failed(detection::describe(error.clone())));
                Err(error)
            }
        };
        self.keep_awake();
        result
    }

    pub fn preload_voice(self) {
        if self.voice.get_untracked().busy() || self.phase().active() {
            return;
        }
        // Set the busy state before yielding so Start cannot initiate a second load.
        self.voice.set(VoiceStatus::Loading);
        spawn_local(async move {
            let _ = self.voice_model().await;
        });
    }

    pub fn start(self) {
        self.start_scored(None);
    }

    pub fn start_spoken_words(self, letters: String) {
        self.start_scored(Some(letters));
    }

    fn start_scored(self, word_letters: Option<String>) {
        let spoken_words = word_letters.is_some();
        let mode = if spoken_words {
            Mode::Voice
        } else {
            self.settings.with_untracked(|s| s.mode)
        };
        if self.phase().active() || (mode == Mode::Voice && self.voice.get_untracked().busy()) {
            return;
        }
        let token = self.invalidate();
        self.station.update(|s| {
            s.spoken_words = spoken_words;
            s.revealed = None;
        });
        self.display(
            Phase::Loading,
            "Getting your station ready.",
            match mode {
                Mode::Voice => "Loading the local speech model. First use downloads about 40 MB.",
                Mode::Keyer => "Loading DeepCW and its runtime, about 26 MB on first use.",
                Mode::Keyboard => "Enabling practice audio.",
            },
            "Audio stays on this device.",
        );
        self.keep_awake();
        spawn_local(async move {
            if let Err(error) = self.prepare(mode, token, word_letters).await {
                if self.valid(token) {
                    self.end();
                    self.feedback(detection::describe(error));
                }
            }
        });
    }

    pub fn start_words(self, letters: String) {
        if self.phase().active() {
            return;
        }
        // iOS treats Web Audio as ambient by default, which can mute the speaker.
        audio::set_session_type("playback");
        let token = self.invalidate();
        let (abort, registration) = AbortHandle::new_pair();
        self.runtime().borrow_mut().pending = Some(abort);
        self.station.update(|s| {
            s.spoken_words = false;
            s.revealed = None;
        });
        self.display(
            Phase::LoadingWords,
            "Getting random words ready.",
            "The words will play one after another.",
            "",
        );
        self.keep_awake();
        spawn_local(async move {
            if let Ok(Err(error)) = Abortable::new(self.play_words(&letters), registration).await {
                if self.valid(token) {
                    self.end();
                    self.feedback(detection::describe(error));
                }
            }
        });
    }

    async fn play_words(self, letters: &str) -> Result<(), JsValue> {
        let ctx = self.ctx()?;
        audio::resume(&ctx).await?;
        self.load_words(letters).await?;
        let runtime = self.runtime();
        self.display(
            Phase::PlayingWords,
            "Listen and copy the words.",
            "Copy in your head or on paper as the words keep coming.",
            "",
        );
        const LEAD: f64 = 0.075;
        let mut radio_path = None;
        let mut radio_settings = None;
        loop {
            let settings = self.settings.get_untracked();
            let mut state = runtime.borrow_mut();
            let volume = settings.volume / 100.;
            let config = (settings.radio, settings.tone, volume);
            if radio_settings.as_ref() != Some(&config) {
                let mut radio = Playback::default();
                let start = ctx.current_time() + LEAD;
                radio_path = radio.radio(&ctx, start, None, settings.tone, volume, &config.0)?;
                state.word_radio = radio;
                radio_settings = Some(config);
            }
            let word = state.words.as_mut().unwrap().draw();
            let (marks, duration) = morse::timings(word, settings.speed, settings.spacing);
            let start = ctx.current_time() + LEAD;
            let mut playback = Playback::default();
            playback.morse(
                &ctx,
                radio_path.as_ref(),
                settings.tone,
                start,
                marks,
                volume,
            )?;
            state.playback = Some(playback);
            drop(state);
            let gap = 7. * morse::spacing_unit(settings.speed, settings.spacing);
            let delay = ((start + duration + gap - LEAD - ctx.current_time()) * 1000.).ceil();
            TimeoutFuture::new(delay.max(0.) as u32).await;
        }
    }

    async fn load_words(self, letters: &str) -> Result<(), JsValue> {
        let runtime = self.runtime();
        let needs_words = runtime.borrow().words.is_none();
        if needs_words {
            let words = WordDeck::load().await?;
            runtime.borrow_mut().words = Some(words);
        }
        let mut state = runtime.borrow_mut();
        state.words.as_mut().unwrap().filter(letters)
    }

    async fn prepare(
        self,
        mode: Mode,
        token: u32,
        word_letters: Option<String>,
    ) -> Result<(), JsValue> {
        let ctx = self.ctx()?;
        audio::resume(&ctx).await?;
        if !self.valid(token) {
            return Ok(());
        }
        if let Some(letters) = word_letters {
            let (abort, registration) = AbortHandle::new_pair();
            let runtime = self.runtime();
            runtime.borrow_mut().pending = Some(abort);
            let Ok(result) = Abortable::new(self.load_words(&letters), registration).await else {
                return Ok(());
            };
            result?;
            let mut state = runtime.borrow_mut();
            state.pending = None;
            if state.word_grammar.is_none() {
                state.word_grammar = Some(state.words.as_ref().unwrap().speech_grammar()?);
            }
        }
        if mode != Mode::Keyboard {
            if mode == Mode::Voice {
                self.voice_model().await?;
            } else {
                let runtime = self.runtime();
                let loaded = runtime.borrow().keyer.is_some();
                if !loaded {
                    let keyer = DeepCw::load().await?;
                    if !self.valid(token) {
                        return Ok(());
                    }
                    runtime.borrow_mut().keyer = Some(Rc::new(keyer));
                }
            }
            if !self.valid(token) {
                return Ok(());
            }
            self.feedback("Allow microphone access to begin. Audio stays on your device.");
            if let Some(mic) =
                Microphone::open(&ctx, mode == Mode::Voice, || self.valid(token)).await?
            {
                self.runtime().borrow_mut().mic = Some(Rc::new(mic));
            } else {
                return Ok(());
            }
        }
        self.new_prompt();
        self.play();
        Ok(())
    }

    pub fn repeat(self) {
        if self.phase().can_replay() {
            self.play();
        }
    }

    fn play(self) {
        let token = self.invalidate();
        self.answer.set(String::new());
        self.station.update(|s| s.revealed = None);
        if self.spoken_words() {
            self.display(
                Phase::Playing,
                "Listen and say the word.",
                "Say the word aloud when you recognize it.",
                "Say “repeat” for another listen.",
            );
        } else if self.mode() == Mode::Voice {
            self.display(
                Phase::Playing,
                "Listen and say your copy.",
                "You can speak the letters and numbers as Morse plays.",
                "Listening locally… letters, numbers, or phonetic words.",
            );
        } else {
            self.display(
                Phase::Playing,
                "Listen. You’ve got this.",
                "Copy the letters and numbers in your head.",
                "Listen for the whole call sign.",
            );
        }
        spawn_local(async move {
            if let Err(error) = self.play_turn(token).await {
                if self.valid(token) {
                    self.end();
                    self.feedback(detection::describe(error));
                }
            }
        });
    }

    async fn play_turn(self, token: u32) -> Result<(), JsValue> {
        if !self.valid(token) {
            return Ok(());
        }
        let ctx = self.ctx()?;
        audio::resume(&ctx).await?;
        if !self.valid(token) {
            return Ok(());
        }
        let settings = self.settings.get_untracked();
        let runtime = self.runtime();
        let mode = self.mode();
        let prompt = runtime.borrow().prompt.clone();
        let (marks, duration) = morse::timings(&prompt, settings.speed, settings.spacing);
        let start = ctx.current_time() + 0.15;
        let volume = settings.volume / 100.;
        let mut playback = Playback::default();
        let path = playback.radio(
            &ctx,
            start,
            Some(duration),
            settings.tone,
            volume,
            &settings.radio,
        )?;
        playback.morse(&ctx, path.as_ref(), settings.tone, start, marks, volume)?;
        runtime.borrow_mut().playback = Some(playback);
        let delay = ((duration + 0.4) * 1000.) as u32;
        if mode != Mode::Voice {
            TimeoutFuture::new(delay).await;
            if !self.valid(token) {
                return Ok(());
            }
            runtime.borrow_mut().playback = None;
        }
        match mode {
            Mode::Keyboard => self.typing("Type your copy, then press Enter."),
            Mode::Voice => self.listen(token, prompt, mode, delay).await,
            Mode::Keyer => self.listen(token, prompt, mode, 0).await,
        }
        Ok(())
    }

    async fn listen(self, token: u32, prompt: String, mode: Mode, delay: u32) {
        let runtime = self.runtime();
        let spoken_words = self.spoken_words();
        let (mic, voice, keyer) = {
            let state = runtime.borrow();
            (state.mic.clone(), state.voice.clone(), state.keyer.clone())
        };
        let word_grammar = if spoken_words {
            runtime.borrow().word_grammar.clone()
        } else {
            None
        };
        let engine = match mode {
            Mode::Voice => voice.as_deref().map(|model| Engine::Voice {
                model,
                word_grammar: word_grammar.as_deref(),
            }),
            Mode::Keyer => keyer.as_deref().map(Engine::Keyer),
            Mode::Keyboard => None,
        };
        let (Some(mic), Some(engine)) = (mic, engine) else {
            if spoken_words {
                self.end();
                self.feedback("The microphone is unavailable. Restart spoken word practice.");
            } else {
                self.typing("The microphone is unavailable. Continue with the keyboard.");
            }
            return;
        };
        if mode == Mode::Keyer {
            self.display(
                Phase::Listening,
                "Your turn. Send your copy.",
                "Send the call sign on your external keyer. Your answer is checked automatically.",
                "Listening for keyer audio. Keep the microphone near its speaker.",
            );
        }
        let (abort, registration) = AbortHandle::new_pair();
        runtime.borrow_mut().pending = Some(abort);
        let result = Abortable::new(
            detection::listen(
                &mic,
                engine,
                token,
                delay,
                |copy| copy_text(copy, mode, spoken_words) == prompt,
                |text| {
                    if self.valid(token) {
                        let prefix = if mode == Mode::Voice {
                            "Hearing"
                        } else {
                            "Decoding"
                        };
                        if !text.is_empty() {
                            self.feedback(format!("{prefix}: {text}"));
                        }
                    }
                },
                || {
                    if self.valid(token) {
                        runtime.borrow_mut().playback = None;
                        self.display(
                            Phase::Listening,
                            "Finish your copy.",
                            if spoken_words {
                                "Say the word now."
                            } else {
                                "Keep speaking, or say the call sign now."
                            },
                            "Listening on your device…",
                        );
                    }
                },
            ),
            registration,
        )
        .await;
        drop(mic);
        if !self.valid(token) {
            return;
        }
        runtime.borrow_mut().pending = None;
        match result {
            Ok(Ok(Output::Copy(copy))) => self.check(&copy),
            Ok(Ok(Output::Repeat)) => self.play(),
            Ok(Ok(Output::Empty)) => {
                self.display(
                    Phase::Listening,
                    if mode == Mode::Voice {
                        "No speech heard."
                    } else {
                        "No Morse decoded."
                    },
                    "Tap Repeat when you’re ready to try again.",
                    "No attempt counted. Your microphone is still connected.",
                );
            }
            Ok(Err(error)) => {
                if mode == Mode::Keyer {
                    runtime.borrow_mut().keyer = None;
                } else if let Some(model) = runtime.borrow_mut().voice.take() {
                    model.terminate();
                    self.voice
                        .set(VoiceStatus::Failed(detection::describe(error.clone())));
                }
                if spoken_words {
                    self.end();
                    self.feedback(detection::describe(error));
                } else {
                    runtime.borrow_mut().playback = None;
                    self.typing(format!(
                        "{} Continue with the keyboard, or restart practice.",
                        detection::describe(error)
                    ));
                }
            }
            Err(_) => {}
        }
    }

    fn typing(self, message: impl Into<String>) {
        self.runtime().borrow_mut().mic = None;
        self.settings.update(|s| s.mode = Mode::Keyboard);
        self.display(
            Phase::Typing,
            "What did you hear?",
            "Type the letters and numbers of the call sign.",
            message,
        );
    }

    pub fn reveal(self) {
        if !self.phase().can_replay() {
            return;
        }
        self.invalidate();
        let runtime = self.runtime();
        let mut state = runtime.borrow_mut();
        let spoken_words = self.spoken_words();
        self.station.update(|s| {
            if !state.attempted {
                let score = s.score_mut();
                score.total += 1;
                score.streak = 0;
            }
            s.revealed = Some(state.prompt.clone());
        });
        state.attempted = true;
        self.display(
            Phase::Revealed,
            if spoken_words {
                "Here’s that word."
            } else {
                "Here’s that call sign."
            },
            "Tap Repeat to listen again, then copy it back.",
            if spoken_words {
                "Reveal counted as a miss. Keep practicing this word."
            } else {
                "Reveal counted as a miss. Keep practicing this call sign."
            },
        );
    }

    pub fn check(self, text: &str) {
        let prompt = self.runtime().borrow().prompt.clone();
        let spoken_words = self.spoken_words();
        let copy = copy_text(text, self.mode(), spoken_words);
        let good = copy == prompt;
        if copy.is_empty()
            || !(matches!(self.phase(), Phase::Typing | Phase::Listening)
                || (self.phase() == Phase::Playing && good))
        {
            return;
        }
        if !spoken_words
            && text
                .split(|c: char| !c.is_ascii_alphanumeric())
                .any(|word| word.eq_ignore_ascii_case("repeat"))
        {
            self.play();
            return;
        }
        let token = self.invalidate();
        self.runtime().borrow_mut().attempted |= !good;
        self.station.update(|s| {
            let score = s.score_mut();
            score.total += 1;
            if good {
                score.correct += 1;
                score.streak += 1;
                score.max_streak = score.max_streak.max(score.streak);
                s.revealed = Some(prompt);
            } else {
                score.streak = 0;
            }
        });
        let (title, instruction, result) = if good {
            (
                "Good copy. Nicely done.",
                if spoken_words {
                    "A new word is coming up."
                } else {
                    "A new call sign is coming up."
                },
                "Correct",
            )
        } else {
            (
                "Not quite. Listen again.",
                if spoken_words {
                    "The same word will play again."
                } else {
                    "Same call sign. Another chance to catch it."
                },
                "Try again",
            )
        };
        self.display(
            Phase::Feedback,
            title,
            instruction,
            if spoken_words && copy == "[UNK]" {
                "Word unclear. Try again.".into()
            } else {
                format!("Your copy: {copy} · {result}")
            },
        );
        spawn_local(async move {
            let _ = self.chime(token, good).await;
            TimeoutFuture::new(if good { 1400 } else { 1800 }).await;
            if self.valid(token) {
                if good {
                    self.new_prompt();
                }
                self.play();
            }
        });
    }

    async fn chime(self, token: u32, good: bool) -> Result<(), JsValue> {
        let ctx = self.ctx()?;
        audio::resume(&ctx).await?;
        if !self.valid(token) {
            return Ok(());
        }
        let mut playback = Playback::default();
        let t = ctx.current_time() + 0.05;
        let volume = self.settings.with_untracked(|s| s.volume / 100.);
        let output: web_sys::AudioNode = ctx.destination().unchecked_into();
        let tones = if good {
            [(880., 0., 0.14, 0.24), (1174.66, 0.15, 0.3, 0.18)]
        } else {
            [(220., 0., 0.42, 0.25), (164.81, 0.09, 0.4, 0.15)]
        };
        for (hz, offset, duration, level) in tones {
            playback.tone(&ctx, &output, hz, t + offset, duration, level * volume)?;
        }
        self.runtime().borrow_mut().playback = Some(playback);
        Ok(())
    }
}

fn copy_text(text: &str, mode: Mode, spoken_words: bool) -> String {
    if spoken_words {
        text.trim().to_ascii_uppercase()
    } else if mode == Mode::Keyer {
        text.chars()
            .filter(|c| !c.is_whitespace())
            .map(|c| c.to_ascii_uppercase())
            .collect()
    } else {
        morse::normalize(text)
    }
}
