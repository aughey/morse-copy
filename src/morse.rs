const MORSE: &[&str] = &[
    ".-", "-...", "-.-.", "-..", ".", "..-.", "--.", "....", "..", ".---", "-.-", ".-..", "--",
    "-.", "---", ".--.", "--.-", ".-.", "...", "-", "..-", "...-", ".--", "-..-", "-.--", "--..",
    "-----", ".----", "..---", "...--", "....-", ".....", "-....", "--...", "---..", "----.",
];
pub fn normalize(text: &str) -> String {
    let cleaned: String = text
        .to_ascii_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { ' ' })
        .collect();
    let words = cleaned
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .replace("double you", "doubleyou")
        .replace("double u", "doubleyou")
        .replace("x ray", "xray");
    words
        .split_whitespace()
        .map(|word| match word {
            "alpha" => "A".into(),
            "alfa" => "A".into(),
            "bravo" => "B".into(),
            "charlie" => "C".into(),
            "delta" => "D".into(),
            "echo" => "E".into(),
            "foxtrot" => "F".into(),
            "golf" => "G".into(),
            "hotel" => "H".into(),
            "india" => "I".into(),
            "juliet" => "J".into(),
            "juliett" => "J".into(),
            "kilo" => "K".into(),
            "lima" => "L".into(),
            "mike" => "M".into(),
            "november" => "N".into(),
            "nancy" => "N".into(),
            "oscar" => "O".into(),
            "papa" => "P".into(),
            "quebec" => "Q".into(),
            "romeo" => "R".into(),
            "sierra" => "S".into(),
            "sugar" => "S".into(),
            "tango" => "T".into(),
            "uniform" => "U".into(),
            "victor" => "V".into(),
            "whiskey" => "W".into(),
            "whisky" => "W".into(),
            "xray" => "X".into(),
            "yankee" => "Y".into(),
            "zulu" => "Z".into(),
            "zero" => "0".into(),
            "oh" => "O".into(),
            "one" => "1".into(),
            "won" => "1".into(),
            "two" => "2".into(),
            "too" => "2".into(),
            "to" => "2".into(),
            "three" => "3".into(),
            "tree" => "3".into(),
            "four" => "4".into(),
            "for" => "4".into(),
            "five" => "5".into(),
            "fife" => "5".into(),
            "six" => "6".into(),
            "seven" => "7".into(),
            "eight" => "8".into(),
            "ate" => "8".into(),
            "nine" => "9".into(),
            "niner" => "9".into(),
            "ay" => "A".into(),
            "aye" => "I".into(),
            "bee" => "B".into(),
            "be" => "B".into(),
            "cee" => "C".into(),
            "see" => "C".into(),
            "sea" => "C".into(),
            "dee" => "D".into(),
            "ee" => "E".into(),
            "ef" => "F".into(),
            "gee" => "G".into(),
            "aitch" => "H".into(),
            "jay" => "J".into(),
            "kay" => "K".into(),
            "el" => "L".into(),
            "ell" => "L".into(),
            "em" => "M".into(),
            "en" => "N".into(),
            "pee" => "P".into(),
            "cue" => "Q".into(),
            "queue" => "Q".into(),
            "are" => "R".into(),
            "ar" => "R".into(),
            "ess" => "S".into(),
            "tee" => "T".into(),
            "tea" => "T".into(),
            "you" => "U".into(),
            "yew" => "U".into(),
            "vee" => "V".into(),
            "doubleyou" => "W".into(),
            "ex" => "X".into(),
            "why" => "Y".into(),
            "zee" => "Z".into(),
            "zed" => "Z".into(),
            _ => word.to_ascii_uppercase(),
        })
        .collect()
}
const ONE: &[&str] = &["F", "G", "M", "I"];
const TWO: &[&str] = &[
    "VE", "VA", "DL", "JA", "VK", "ZL", "EA", "EI", "ON", "PA", "OZ", "SM", "OH", "SP", "OK", "OM",
    "HA", "HB", "OE", "CT", "PY", "LU", "CE", "ZS", "VU", "HL", "BY", "9A", "9H", "S5",
];

pub fn generate(format: &str, international: bool, random: impl Fn(usize) -> usize) -> String {
    let format = if format == "mixed" {
        ["short", "long", "two"][random(3)]
    } else {
        format
    };
    let practice = format
        .strip_prefix("practice-")
        .and_then(|s| s.split_once('-'))
        .and_then(|(p, s)| Some((p.parse::<usize>().ok()?, s.parse::<usize>().ok()?)))
        .filter(|(p, s)| (1..=2).contains(p) && (1..=3).contains(s));
    let (prefix_len, suffix_len) = practice.map_or_else(
        || {
            (
                if format == "two" { 2 } else { 1 },
                if format == "short" { 2 } else { 3 },
            )
        },
        |(p, s)| (1 + random(p), 1 + random(s)),
    );
    let letter = || (b'A' + random(26) as u8) as char;
    let mut call = if international && random(2) == 1 {
        let pool = if prefix_len == 1 { ONE } else { TWO };
        let prefixes: Vec<_> = pool
            .iter()
            .filter(|p| practice.is_none() || p.bytes().all(|c| c.is_ascii_alphabetic()))
            .collect();
        prefixes[random(prefixes.len())].to_string()
    } else if prefix_len == 2 {
        let first = ['A', 'K', 'N', 'W'][random(4)];
        let second = if first == 'A' {
            (b'A' + random(12) as u8) as char
        } else {
            letter()
        };
        String::from_iter([first, second])
    } else {
        ['K', 'N', 'W'][random(3)].to_string()
    };
    call.push((b'0' + random(10) as u8) as char);
    call.extend((0..suffix_len).map(|_| letter()));
    call
}

pub fn timings(call: &str, wpm: f64, effective: f64) -> (Vec<(f64, f64)>, f64) {
    let dot = 1.2 / wpm;
    let gap = dot.max((60.0 / effective.min(wpm) - 31.0 * dot) / 19.0);
    let mut elapsed = 0.0;
    let mut events = Vec::new();
    for (i, c) in call.bytes().enumerate() {
        let index = match c {
            b'A'..=b'Z' => c - b'A',
            b'0'..=b'9' => c - b'0' + 26,
            _ => continue,
        };
        if i > 0 {
            elapsed += 3.0 * gap;
        }
        for (j, mark) in MORSE[index as usize].bytes().enumerate() {
            if j > 0 {
                elapsed += dot;
            }
            let duration = if mark == b'-' { 3.0 * dot } else { dot };
            events.push((elapsed, duration));
            elapsed += duration;
        }
    }
    (events, elapsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voice_and_farnsworth_copy() {
        assert_eq!(normalize("Kilo one x-ray double-you Nancy"), "K1XWN");
        let (marks, duration) = timings("ET", 20., 20.);
        assert_eq!(marks.len(), 2);
        for ((at, length), (expected_at, expected_length)) in
            marks.into_iter().zip([(0., 0.06), (0.24, 0.18)])
        {
            assert!((at - expected_at).abs() < 1e-9);
            assert!((length - expected_length).abs() < 1e-9);
        }
        assert!(timings("ET", 20., 10.).1 > duration);
    }

    #[test]
    fn head_copy_keeps_one_digit() {
        let call = generate("practice-2-3", true, |n| n - 1);
        assert_eq!(call.len(), 6);
        assert_eq!(call.bytes().filter(u8::is_ascii_digit).count(), 1);
    }
}
