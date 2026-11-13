// Browser capture and recognition policy. The JS model engines report only
// transcripts and errors. A capture owns its listeners and releases them on drop.
use futures::{
    channel::mpsc,
    future::{select, Either},
    StreamExt,
};
use gloo_events::EventListener;
use gloo_timers::future::TimeoutFuture;
use js_sys::{Array, Float32Array, Object, Reflect};
use wasm_bindgen::{prelude::*, JsCast};
use wasm_bindgen_futures::JsFuture;
use web_sys::{
    AudioContext, AudioWorkletNode, CustomEvent, Event, EventTarget, MediaStream,
    MediaStreamAudioSourceNode, MediaStreamConstraints, MediaStreamTrack, MediaTrackConstraints,
    MessageEvent, MessagePort, Worker,
};

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(extends = EventTarget, js_namespace = Vosk)]
    pub type Model;
    #[wasm_bindgen(constructor, catch, js_namespace = Vosk)]
    fn new(url: &str, log_level: i32) -> Result<Model, JsValue>;
    #[wasm_bindgen(method, getter)]
    pub fn ready(this: &Model) -> bool;
    #[wasm_bindgen(method)]
    pub fn terminate(this: &Model);
    #[wasm_bindgen(method, getter, js_name = KaldiRecognizer)]
    fn recognizer_class(this: &Model) -> js_sys::Function;

    #[wasm_bindgen(extends = EventTarget)]
    type Recognizer;
    #[wasm_bindgen(method, catch, js_name = acceptWaveformFloat)]
    fn accept(this: &Recognizer, samples: &Float32Array, rate: f32) -> Result<(), JsValue>;
    #[wasm_bindgen(method, js_name = retrieveFinalResult)]
    fn flush(this: &Recognizer);
    #[wasm_bindgen(method)]
    fn remove(this: &Recognizer);
}

fn get(object: &JsValue, key: &str) -> JsValue {
    Reflect::get(object, &key.into()).unwrap_or(JsValue::UNDEFINED)
}

fn text(object: &JsValue, key: &str) -> String {
    get(object, key).as_string().unwrap_or_default()
}

fn object(fields: &[(&str, JsValue)]) -> Object {
    let object = Object::new();
    for (key, value) in fields {
        let _ = Reflect::set(&object, &(*key).into(), value);
    }
    object
}

pub fn error(message: &str) -> JsValue {
    js_sys::Error::new(message).into()
}

pub fn describe(value: JsValue) -> String {
    if text(&value, "name") == "NotAllowedError" {
        "Microphone permission was not granted. Allow access in your browser settings, or select Keyboard.".into()
    } else {
        get(&value, "message")
            .as_string()
            .or_else(|| value.as_string())
            .unwrap_or_else(|| "The browser could not complete audio setup.".into())
    }
}

fn detail(event: &Event) -> JsValue {
    event.unchecked_ref::<CustomEvent>().detail()
}

fn data(event: &Event) -> JsValue {
    event.unchecked_ref::<MessageEvent>().data()
}

pub fn supported() -> bool {
    let window = web_sys::window().unwrap();
    Reflect::has(&window, &"AudioWorkletNode".into()).unwrap_or(false)
        && window.navigator().media_devices().is_ok()
}

async fn ready(
    receive: &mut mpsc::UnboundedReceiver<Result<(), JsValue>>,
    message: &str,
) -> Result<(), JsValue> {
    match select(receive.next(), TimeoutFuture::new(120_000)).await {
        Either::Left((Some(result), _)) => result,
        _ => Err(error(message)),
    }
}

pub async fn load_voice(progress: impl Fn(u32) + 'static) -> Result<Model, JsValue> {
    let url = web_sys::window()
        .unwrap()
        .document()
        .unwrap()
        .base_uri()?
        .unwrap_or_default();
    let url = web_sys::Url::new_with_base("models/vosk-en-us-0.15.tar.gz", &url)?.href();
    let model = Model::new(&url, -1)?;
    let (send, mut receive) = mpsc::unbounded();
    let loaded = send.clone();
    let _load = EventListener::new(&model, "load", move |event| {
        let result = if get(&detail(event), "result").as_bool() == Some(true) {
            Ok(())
        } else {
            Err(error("The voice model could not be loaded. Please retry."))
        };
        let _ = loaded.unbounded_send(result);
    });
    let _error = EventListener::new(&model, "error", move |event| {
        let _ = send.unbounded_send(Err(error(&text(&detail(event), "error"))));
    });
    let _progress = EventListener::new(&model, "downloadprogress", move |event| {
        let detail = detail(event);
        let loaded = get(&detail, "loaded").as_f64().unwrap_or_default();
        if let Some(total) = get(&detail, "total").as_f64().filter(|n| *n > 0.) {
            progress((loaded / total * 100.) as u32);
        }
    });
    if let Err(failure) = ready(&mut receive, "Voice setup timed out. Please retry.").await {
        model.terminate();
        return Err(failure);
    }
    Ok(model)
}

pub struct DeepCw(Worker);

impl Drop for DeepCw {
    fn drop(&mut self) {
        self.0.terminate();
    }
}

impl DeepCw {
    pub async fn load() -> Result<Self, JsValue> {
        let worker = Self(Worker::new("deepcw-worker.js")?);
        let (send, mut receive) = mpsc::unbounded();
        let failed = send.clone();
        let _error = EventListener::new(&worker.0, "error", move |_| {
            let _ = failed.unbounded_send(Err(error("DeepCW could not start.")));
        });
        let _message = EventListener::new(&worker.0, "message", move |event| {
            let data = data(event);
            let result = match text(&data, "type").as_str() {
                "ready" => Ok(()),
                "error" => Err(error(&text(&data, "message"))),
                _ => return,
            };
            let _ = send.unbounded_send(result);
        });
        worker.0.post_message(&object(&[("type", "load".into())]))?;
        ready(&mut receive, "DeepCW loading timed out. Please retry.").await?;
        Ok(worker)
    }
}

struct Stream(MediaStream);

impl Drop for Stream {
    fn drop(&mut self) {
        for track in self.0.get_tracks() {
            track.unchecked_into::<MediaStreamTrack>().stop();
        }
    }
}

pub struct Microphone {
    stream: Stream,
    source: MediaStreamAudioSourceNode,
    node: AudioWorkletNode,
    port: MessagePort,
    rate: f32,
}

impl Microphone {
    pub async fn open(
        ctx: &AudioContext,
        voice: bool,
        valid: impl Fn() -> bool,
    ) -> Result<Option<Self>, JsValue> {
        // Load the worklet before asking for a stream so cancellation while it
        // loads cannot leave microphone tracks open.
        let worklet = ctx.audio_worklet()?;
        JsFuture::from(worklet.add_module("mic-worklet.js")?).await?;
        if !valid() {
            return Ok(None);
        }
        let audio = MediaTrackConstraints::new();
        audio.set_channel_count(&1.into());
        audio.set_echo_cancellation(&voice.into());
        audio.set_noise_suppression(&voice.into());
        audio.set_auto_gain_control(&voice.into());
        let constraints = MediaStreamConstraints::new();
        constraints.set_audio(&audio);
        let devices = web_sys::window().unwrap().navigator().media_devices()?;
        let stream = Stream(
            JsFuture::from(devices.get_user_media_with_constraints(&constraints)?)
                .await?
                .dyn_into()?,
        );
        if !valid() {
            return Ok(None);
        }
        let node = AudioWorkletNode::new(ctx, "morse-microphone")?;
        let port = node.port()?;
        let source = ctx.create_media_stream_source(&stream.0)?;
        let mic = Self {
            stream,
            source,
            node,
            port,
            rate: ctx.sample_rate(),
        };
        mic.source.connect_with_audio_node(&mic.node)?;
        mic.node.connect_with_audio_node(&ctx.destination())?;
        mic.port.start();
        Ok(Some(mic))
    }

    pub fn active(&self, id: Option<u32>) {
        let _ = self.port.post_message(&object(&[(
            "active",
            id.map(JsValue::from).unwrap_or(JsValue::NULL),
        )]));
    }
}

impl Drop for Microphone {
    fn drop(&mut self) {
        let _ = self.source.disconnect();
        let _ = self.node.disconnect();
        self.port.close();
    }
}

pub enum Engine<'a> {
    Voice {
        model: &'a Model,
        word_grammar: Option<&'a str>,
    },
    Keyer(&'a DeepCw),
}

enum Input {
    Partial(String),
    Result(String),
    Tone,
    Error(JsValue),
}

pub enum Output {
    Copy(String),
    Repeat,
    Empty,
}

enum Decoder {
    Voice(Recognizer),
    Keyer(Worker, u32),
}

impl Drop for Decoder {
    fn drop(&mut self) {
        match self {
            Self::Voice(recognizer) => recognizer.remove(),
            Self::Keyer(worker, id) => {
                let _ =
                    worker.post_message(&object(&[("type", "stop".into()), ("id", (*id).into())]));
            }
        }
    }
}

fn has_tone(samples: &Float32Array, rate: f32) -> bool {
    let samples = samples.to_vec();
    let count = (samples.len() as f64 * 3200. / rate as f64) as usize;
    if count < 32 {
        return false;
    }
    let signal: Vec<_> = (0..count)
        .map(|i| samples[(i as f64 * rate as f64 / 3200.) as usize] as f64)
        .collect();
    let energy: f64 = signal.iter().map(|s| s * s).sum();
    if energy / (count as f64) < 2.5e-7 {
        return false;
    }
    (400..=1200).step_by(25).any(|hz| {
        let coefficient = 2. * (std::f64::consts::TAU * hz as f64 / 3200.).cos();
        let (previous, before) = signal.iter().fold((0., 0.), |(previous, before), sample| {
            (sample + coefficient * previous - before, previous)
        });
        let power = previous * previous + before * before - coefficient * previous * before;
        power / (count as f64 * energy) > 0.15
    })
}

struct Capture<'a> {
    mic: &'a Microphone,
    decoder: Decoder,
    _listeners: Vec<EventListener>,
    receive: mpsc::UnboundedReceiver<Input>,
}

impl Drop for Capture<'_> {
    fn drop(&mut self) {
        self.mic.active(None);
    }
}

impl<'a> Capture<'a> {
    fn start(mic: &'a Microphone, engine: Engine<'_>, id: u32) -> Result<Self, JsValue> {
        let (send, receive) = mpsc::unbounded();
        let mut listeners = Vec::new();
        let decoder = match engine {
            Engine::Voice {
                model,
                word_grammar,
            } => {
                let grammar = word_grammar.unwrap_or(include_str!("voice_grammar.json"));
                let args = Array::of2(&mic.rate.into(), &grammar.into());
                let recognizer: Recognizer =
                    Reflect::construct(&model.recognizer_class(), &args)?.unchecked_into();
                for (event, field) in [("result", "text"), ("partialresult", "partial")] {
                    let send = send.clone();
                    listeners.push(EventListener::new(&recognizer, event, move |message| {
                        let copy = text(&get(&detail(message), "result"), field);
                        let _ = send.unbounded_send(if field == "text" {
                            Input::Result(copy)
                        } else {
                            Input::Partial(copy)
                        });
                    }));
                }
                for target in [
                    recognizer.unchecked_ref::<EventTarget>(),
                    model.unchecked_ref(),
                ] {
                    let send = send.clone();
                    listeners.push(EventListener::new(target, "error", move |event| {
                        let _ = send
                            .unbounded_send(Input::Error(error(&text(&detail(event), "error"))));
                    }));
                }
                Decoder::Voice(recognizer)
            }
            Engine::Keyer(engine) => {
                let worker = &engine.0;
                let messages = send.clone();
                listeners.push(EventListener::new(worker, "message", move |event| {
                    let data = data(event);
                    if get(&data, "id").as_f64() != Some(id as f64) {
                        return;
                    }
                    let input = match text(&data, "type").as_str() {
                        "partial" => Input::Partial(text(&data, "text")),
                        "result" => Input::Result(text(&data, "text")),
                        "error" => Input::Error(error(&text(&data, "message"))),
                        _ => return,
                    };
                    let _ = messages.unbounded_send(input);
                }));
                let failed = send.clone();
                listeners.push(EventListener::new(worker, "error", move |_| {
                    let _ = failed.unbounded_send(Input::Error(error(
                        "DeepCW stopped. Restart keyer practice.",
                    )));
                }));
                worker.post_message(&object(&[
                    ("type", "start".into()),
                    ("id", id.into()),
                    ("rate", mic.rate.into()),
                ]))?;
                Decoder::Keyer(worker.clone(), id)
            }
        };
        for track in mic.stream.0.get_audio_tracks() {
            let send = send.clone();
            listeners.push(EventListener::new(
                track.unchecked_ref::<EventTarget>(),
                "ended",
                move |_| {
                    let _ = send.unbounded_send(Input::Error(error(
                        "Microphone disconnected. Restart practice.",
                    )));
                },
            ));
        }
        let rate = mic.rate;
        let port_input = send;
        match &decoder {
            Decoder::Voice(recognizer) => {
                let recognizer = JsValue::from((*recognizer).clone());
                listeners.push(EventListener::new(&mic.port, "message", move |event| {
                    let data = data(event);
                    if get(&data, "id").as_f64() == Some(id as f64) {
                        let samples = get(&data, "samples").unchecked_into();
                        if let Err(e) = recognizer
                            .unchecked_ref::<Recognizer>()
                            .accept(&samples, rate)
                        {
                            let _ = port_input.unbounded_send(Input::Error(e));
                        }
                    }
                }));
            }
            Decoder::Keyer(worker, _) => {
                let worker = worker.clone();
                listeners.push(EventListener::new(&mic.port, "message", move |event| {
                    let data = data(event);
                    let result = if get(&data, "id").as_f64() == Some(id as f64) {
                        let samples: Float32Array = get(&data, "samples").unchecked_into();
                        if has_tone(&samples, rate) {
                            let _ = port_input.unbounded_send(Input::Tone);
                        }
                        let message = object(&[
                            ("type", "samples".into()),
                            ("id", id.into()),
                            ("samples", samples.clone().into()),
                        ]);
                        worker.post_message_with_transfer(&message, &Array::of1(&samples.buffer()))
                    } else if get(&data, "flushed").as_f64() == Some(id as f64) {
                        worker
                            .post_message(&object(&[("type", "finish".into()), ("id", id.into())]))
                    } else {
                        return;
                    };
                    if let Err(e) = result {
                        let _ = port_input.unbounded_send(Input::Error(e));
                    }
                }));
            }
        }
        mic.active(Some(id));
        Ok(Self {
            mic,
            decoder,
            _listeners: listeners,
            receive,
        })
    }

    fn flush(&self) -> Result<(), JsValue> {
        match &self.decoder {
            Decoder::Voice(recognizer) => {
                self.mic.active(None);
                recognizer.flush();
                Ok(())
            }
            Decoder::Keyer(_, id) => self
                .mic
                .port
                .post_message(&object(&[("flush", (*id).into())])),
        }
    }
}

pub async fn listen(
    mic: &Microphone,
    engine: Engine<'_>,
    id: u32,
    playback_ms: u32,
    complete: impl Fn(&str) -> bool,
    partial: impl Fn(&str),
    playback_ended: impl Fn(),
) -> Result<Output, JsValue> {
    let voice = matches!(engine, Engine::Voice { .. });
    let spoken_word = matches!(
        engine,
        Engine::Voice {
            word_grammar: Some(_),
            ..
        }
    );
    let mut capture = Capture::start(mic, engine, id)?;
    let mut playback = playback_ms > 0;
    let mut segments = String::new();
    let mut latest = String::new();
    let mut settle = f64::INFINITY;
    let clock = web_sys::window().unwrap().performance().unwrap();
    let playback_end = clock.now() + f64::from(playback_ms);
    let mut deadline = if voice {
        playback_end + 18_000.
    } else {
        clock.now() + 60_000.
    };
    let mut flushing = false;

    loop {
        let now = clock.now();
        if playback && now >= playback_end {
            playback = false;
            playback_ended();
        }
        if !flushing && !playback && now >= settle {
            if voice {
                return Ok(Output::Copy(segments));
            }
            capture.flush()?;
            flushing = true;
            deadline = now + 60_000.;
        }
        if now >= deadline {
            if flushing {
                return Err(error("Decoding timed out. Tap Repeat to try again."));
            }
            capture.flush()?;
            flushing = true;
            deadline = now + if voice { 8_000. } else { 60_000. };
        }
        let wake = if playback {
            playback_end
        } else if flushing {
            deadline
        } else {
            settle.min(deadline)
        };
        let event = match select(
            capture.receive.next(),
            TimeoutFuture::new((wake - now).ceil().max(0.) as u32),
        )
        .await
        {
            Either::Left((Some(event), _)) => event,
            Either::Left((None, _)) => return Err(error("Recognition disconnected.")),
            Either::Right(_) => continue,
        };
        let final_segment = matches!(event, Input::Result(_));
        match event {
            Input::Error(e) => return Err(e),
            Input::Tone => {
                if !latest.is_empty() {
                    settle = clock.now() + 1800.;
                }
            }
            Input::Result(text) if !voice => {
                return Ok(if text.trim().is_empty() {
                    Output::Empty
                } else {
                    Output::Copy(text)
                });
            }
            Input::Result(text) | Input::Partial(text) => {
                let text = text.trim();
                let repeat = if spoken_word {
                    text.eq_ignore_ascii_case("repeat")
                } else {
                    voice
                        && text
                            .split(|c: char| !c.is_ascii_alphanumeric())
                            .any(|word| word.eq_ignore_ascii_case("repeat"))
                };
                if repeat {
                    return Ok(Output::Repeat);
                }
                if spoken_word {
                    if complete(text) {
                        return Ok(Output::Copy(text.into()));
                    }
                    if final_segment {
                        if !text.is_empty() {
                            segments = text.into();
                            settle = clock.now();
                        }
                        if flushing || (!playback && !segments.is_empty()) {
                            return Ok(if segments.is_empty() {
                                Output::Empty
                            } else {
                                Output::Copy(segments)
                            });
                        }
                    }
                    partial(text);
                    continue;
                }
                let copy = if voice {
                    if final_segment && !text.is_empty() {
                        if !segments.is_empty() {
                            segments.push(' ');
                        }
                        segments.push_str(text);
                        settle = clock.now() + 1200.;
                    } else if !final_segment && !text.is_empty() {
                        settle = f64::INFINITY;
                    }
                    if final_segment || text.is_empty() {
                        segments.clone()
                    } else if segments.is_empty() {
                        text.into()
                    } else {
                        format!("{segments} {text}")
                    }
                } else {
                    if !text.is_empty() && text != latest {
                        settle = clock.now() + 1800.;
                        latest = text.into();
                    }
                    text.into()
                };
                if complete(&copy) || (flushing && final_segment) {
                    return Ok(if copy.is_empty() {
                        Output::Empty
                    } else {
                        Output::Copy(copy)
                    });
                }
                partial(&copy);
            }
        }
    }
}
