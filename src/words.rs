use js_sys::{Array, Error, Math};
use std::collections::HashSet;
use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;
use web_sys::Response;

pub struct WordDeck {
    words: Vec<String>,
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
        Ok(Self { words, next: 0 })
    }

    pub fn draw(&mut self) -> &str {
        let mut end = self.words.len();
        if self.next == end {
            self.next = 0;
            // Exclude the last word of the previous pass from the first draw.
            end -= 1;
        }
        let index = self.next + (Math::random() * (end - self.next) as f64) as usize;
        self.words.swap(self.next, index);
        self.next += 1;
        &self.words[self.next - 1]
    }
}
