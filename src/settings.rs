use crate::{audio::Radio, detection};
use js_sys::{Object, Reflect, JSON};
use web_sys::Storage;

const SETTINGS_KEY: &str = "morse-copy-settings";

fn storage() -> Option<Storage> {
    web_sys::window()?.local_storage().ok().flatten()
}

pub fn preference(key: &str) -> Option<String> {
    storage()?.get_item(key).ok().flatten()
}

pub fn store(key: &str, value: &str) {
    if let Some(storage) = storage() {
        let _ = storage.set_item(key, value);
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Voice,
    Keyboard,
    Keyer,
}

impl Mode {
    pub fn from_value(value: &str) -> Self {
        match value {
            "type" => Self::Keyboard,
            "keyer" => Self::Keyer,
            _ => Self::Voice,
        }
    }

    pub fn value(self) -> &'static str {
        match self {
            Self::Voice => "voice",
            Self::Keyboard => "type",
            Self::Keyer => "keyer",
        }
    }

    pub fn title(self) -> &'static str {
        match self {
            Self::Voice => "Voice",
            Self::Keyboard => "Keyboard",
            Self::Keyer => "External keyer",
        }
    }

    pub fn badge(self) -> &'static str {
        match self {
            Self::Voice => "VOSK · ON DEVICE",
            Self::Keyboard => "KEYBOARD",
            Self::Keyer => "DEEPCW · ON DEVICE",
        }
    }

    pub fn note(self) -> &'static str {
        match self {
            Self::Voice => "Listening during Morse and your answer. Audio stays local.",
            Self::Keyboard => "Type the complete call sign, then press Enter.",
            Self::Keyer => {
                "Keyer audio is decoded locally after playback. Answers are checked automatically."
            }
        }
    }

    pub fn welcome(self) -> &'static str {
        match self {
            Self::Voice => {
                "Press start and speak the letters as Morse plays, or answer afterwards."
            }
            Self::Keyboard => {
                "Press start, listen to the Morse code, then type the letters and numbers."
            }
            Self::Keyer => "Press start, listen, then send the call sign with your external keyer.",
        }
    }
}

#[derive(Clone)]
pub struct Settings {
    pub speed: f64,
    pub spacing: f64,
    pub tone: f64,
    pub volume: f64,
    pub radio: Radio,
    pub format: String,
    pub international: bool,
    pub mode: Mode,
}

impl Settings {
    const RANGES: [(&'static str, f64, f64, f64); 7] = [
        ("speed", 18., 5., 40.),
        ("spacing", 12., 5., 40.),
        ("tone", 600., 350., 900.),
        ("volume", 65., 0., 100.),
        ("staticLevel", 0., 0., 100.),
        ("interference", 0., 0., 100.),
        ("fading", 0., 0., 100.),
    ];

    pub fn load() -> Self {
        let saved = preference(SETTINGS_KEY).and_then(|json| JSON::parse(&json).ok());
        let read = |key: &str| {
            saved
                .as_ref()
                .and_then(|v| Reflect::get(v, &key.into()).ok())
                .and_then(|v| v.as_string())
        };
        let mut settings = Self {
            speed: 18.,
            spacing: 12.,
            tone: 600.,
            volume: 65.,
            radio: Radio::default(),
            format: read("format")
                .filter(|s| {
                    matches!(
                        s.as_str(),
                        "mixed"
                            | "short"
                            | "long"
                            | "two"
                            | "practice-1-1"
                            | "practice-1-2"
                            | "practice-1-3"
                            | "practice-2-1"
                            | "practice-2-2"
                            | "practice-2-3"
                    )
                })
                .unwrap_or_else(|| "mixed".into()),
            international: read("includeInternational").as_deref() != Some("no"),
            mode: Mode::from_value(read("inputMode").as_deref().unwrap_or_default()),
        };
        for (key, default, min, max) in Self::RANGES {
            let value = read(key)
                .and_then(|s| s.parse::<f64>().ok())
                .filter(|n| n.is_finite())
                .unwrap_or(default)
                .clamp(min, max);
            *settings.range_mut(key) = value;
        }
        settings.spacing = settings.spacing.min(settings.speed);
        if !detection::supported() {
            settings.mode = Mode::Keyboard;
        }
        settings
    }

    pub fn save(&self) {
        let object = Object::new();
        let set = |key: &str, value: &str| {
            let _ = Reflect::set(&object, &key.into(), &value.into());
        };
        for (key, _, _, _) in Self::RANGES {
            set(key, &self.range(key).to_string());
        }
        set("format", &self.format);
        set("inputMode", self.mode.value());
        set(
            "includeInternational",
            if self.international { "yes" } else { "no" },
        );
        if let Ok(json) = JSON::stringify(&object) {
            if let Some(json) = json.as_string() {
                store(SETTINGS_KEY, &json);
            }
        }
    }

    pub fn range(&self, key: &str) -> f64 {
        match key {
            "speed" => self.speed,
            "spacing" => self.spacing,
            "tone" => self.tone,
            "volume" => self.volume,
            "staticLevel" => self.radio.static_level,
            "interference" => self.radio.interference,
            "fading" => self.radio.fading,
            _ => unreachable!("unknown range {key}"),
        }
    }

    pub fn range_mut(&mut self, key: &str) -> &mut f64 {
        match key {
            "speed" => &mut self.speed,
            "spacing" => &mut self.spacing,
            "tone" => &mut self.tone,
            "volume" => &mut self.volume,
            "staticLevel" => &mut self.radio.static_level,
            "interference" => &mut self.radio.interference,
            "fading" => &mut self.radio.fading,
            _ => unreachable!("unknown range {key}"),
        }
    }
}
