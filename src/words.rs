use js_sys::{Array, Error, Math};
use std::collections::HashSet;
use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;
use web_sys::Response;

pub struct WordDeck {
    words: Vec<String>,
    order: Vec<usize>,
    letters: Vec<u8>,
    next: usize,
}

impl WordDeck {
    pub async fn load() -> Result<Self, JsValue> {
        let response: Response =
            JsFuture::from(web_sys::window().unwrap().fetch_with_str("./words.json"))
                .await?
                .dyn_into()?;
        if !response.ok() {
            return Err(Error::new(&format!(
                "Word list request returned HTTP {}.",
                response.status()
            ))
            .into());
        }
        let list: Array = JsFuture::from(response.json()?)
            .await?
            .dyn_into()
            .map_err(|_| Error::new("The word list must be a JSON array."))?;
        let mut seen = HashSet::new();
        let words: Vec<_> = list
            .iter()
            .filter_map(|value| value.as_string())
            .filter(|word| !word.is_empty() && word.bytes().all(|c| c.is_ascii_alphabetic()))
            .map(|word| word.to_ascii_uppercase())
            .filter(|word| seen.insert(word.clone()))
            .collect();
        if words.len() < 2 {
            return Err(Error::new("The word list needs at least two distinct words.").into());
        }
        Ok(Self {
            order: (0..words.len()).collect(),
            words,
            letters: Vec::new(),
            next: 0,
        })
    }

    pub fn filter(&mut self, input: &str) -> Result<(), JsValue> {
        let mut letters: Vec<_> = input
            .bytes()
            .filter(u8::is_ascii_alphabetic)
            .map(|letter| letter.to_ascii_uppercase())
            .collect();
        letters.sort_unstable();
        letters.dedup();
        if letters == self.letters {
            return Ok(());
        }

        let order: Vec<_> = self
            .words
            .iter()
            .enumerate()
            .filter(|(_, word)| letters.is_empty() || word.bytes().any(|c| letters.contains(&c)))
            .map(|(index, _)| index)
            .collect();
        if order.is_empty() {
            return Err(Error::new(
                "No words contain those letters. Try other letters or clear the filter.",
            )
            .into());
        }

        self.order = order;
        self.letters = letters;
        self.next = 0;
        Ok(())
    }

    pub fn speech_grammar(&self) -> Result<String, JsValue> {
        let vocabulary = Array::new();
        for word in &self.words {
            vocabulary.push(&word.to_ascii_lowercase().into());
        }
        vocabulary.push(&"repeat".into());
        vocabulary.push(&"[unk]".into());
        Ok(js_sys::JSON::stringify(&vocabulary)?.into())
    }

    pub fn draw(&mut self) -> &str {
        let mut end = self.order.len();
        if self.next == end {
            self.next = 0;
            // Exclude the last word of the previous pass from the first draw.
            if end > 1 {
                end -= 1;
            }
        }
        let index = self.next + (Math::random() * (end - self.next) as f64) as usize;
        self.order.swap(self.next, index);
        self.next += 1;
        &self.words[self.order[self.next - 1]]
    }
}
