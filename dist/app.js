"use strict";
const $ = (id) => document.getElementById(id);
const MORSE = {
  A: ".-",
  B: "-...",
  C: "-.-.",
  D: "-..",
  E: ".",
  F: "..-.",
  G: "--.",
  H: "....",
  I: "..",
  J: ".---",
  K: "-.-",
  L: ".-..",
  M: "--",
  N: "-.",
  O: "---",
  P: ".--.",
  Q: "--.-",
  R: ".-.",
  S: "...",
  T: "-",
  U: "..-",
  V: "...-",
  W: ".--",
  X: "-..-",
  Y: "-.--",
  Z: "--..",
  0: "-----",
  1: ".----",
  2: "..---",
  3: "...--",
  4: "....-",
  5: ".....",
  6: "-....",
  7: "--...",
  8: "---..",
  9: "----.",
};
const WORDS = {
  alpha: "A",
  alfa: "A",
  bravo: "B",
  charlie: "C",
  delta: "D",
  echo: "E",
  foxtrot: "F",
  golf: "G",
  hotel: "H",
  india: "I",
  juliet: "J",
  juliett: "J",
  kilo: "K",
  lima: "L",
  mike: "M",
  november: "N",
  nancy: "N",
  oscar: "O",
  papa: "P",
  quebec: "Q",
  romeo: "R",
  sierra: "S",
  sugar: "S",
  tango: "T",
  uniform: "U",
  victor: "V",
  whiskey: "W",
  whisky: "W",
  xray: "X",
  yankee: "Y",
  zulu: "Z",
  zero: "0",
  oh: "O",
  one: "1",
  won: "1",
  two: "2",
  too: "2",
  to: "2",
  three: "3",
  tree: "3",
  four: "4",
  for: "4",
  five: "5",
  fife: "5",
  six: "6",
  seven: "7",
  eight: "8",
  ate: "8",
  nine: "9",
  niner: "9",
  ay: "A",
  aye: "I",
  bee: "B",
  be: "B",
  cee: "C",
  see: "C",
  sea: "C",
  dee: "D",
  ee: "E",
  ef: "F",
  gee: "G",
  aitch: "H",
  jay: "J",
  kay: "K",
  el: "L",
  ell: "L",
  em: "M",
  en: "N",
  pee: "P",
  cue: "Q",
  queue: "Q",
  are: "R",
  ar: "R",
  ess: "S",
  tee: "T",
  tea: "T",
  you: "U",
  yew: "U",
  vee: "V",
  doubleyou: "W",
  ex: "X",
  why: "Y",
  zee: "Z",
  zed: "Z",
};
function normalize(text) {
  return text
    .toLowerCase()
    .replace(/double[\s-]+(?:you|u)/g, " w ")
    .replace(/x[\s-]+ray/g, " xray ")
    .replace(/[^a-z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .map((t) => WORDS[t] || t.toUpperCase())
    .join("");
}
function randomInt(n) {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return Math.floor((a[0] / 4294967296) * n);
}
// Practice prefixes, not a registry of assigned stations.
// Sources: arrl.org/international-call-sign-series and RSGB international-prefixes.
const INTERNATIONAL_PREFIXES = {
  one: ["F", "G", "M", "I"],
  two: [
    "VE", "VA", "DL", "JA", "VK", "ZL", "EA", "EI", "ON", "PA",
    "OZ", "SM", "OH", "SP", "OK", "OM", "HA", "HB", "OE", "CT",
    "PY", "LU", "CE", "ZS", "VU", "HL", "BY", "9A", "9H", "S5",
  ],
};
function generateCall(format, includeInternational = true) {
  const f = format === "mixed" ? ["short", "long", "two"][randomInt(3)] : format;
  const letter = () => String.fromCharCode(65 + randomInt(26));
  const pick = (items) => items[randomInt(items.length)];
  const practice = /^practice-([12])-([123])$/.exec(f);
  const prefixLength = practice ? 1 + randomInt(+practice[1]) : f === "two" ? 2 : 1;
  const suffixLength = practice ? 1 + randomInt(+practice[2]) : f === "short" ? 2 : 3;
  // Give international calls half the practice, regardless of prefix pool size.
  const international = includeInternational && randomInt(2) === 1;
  let prefix;
  if (international) {
    const prefixes = INTERNATIONAL_PREFIXES[prefixLength === 2 ? "two" : "one"];
    // Head-copy practice always has letters around exactly one digit.
    prefix = pick(practice ? prefixes.filter((p) => /^[A-Z]+$/.test(p)) : prefixes);
  } else if (prefixLength === 2) {
    // Balance initial letters so K prefixes don't drown out Alpha and November.
    const first = pick(["A", "K", "N", "W"]);
    prefix = first + (first === "A" ? pick("ABCDEFGHIJKL") : letter());
  } else {
    prefix = pick(["K", "N", "W"]);
  }
  return (
    prefix +
    randomInt(10) +
    Array.from({ length: suffixLength }, letter).join("")
  );
}
function timings(call, wpm, effective) {
  const dot = 1.2 / wpm;
  const gapUnit = Math.max(
    dot,
    (60 / Math.min(effective, wpm) - 31 * dot) / 19,
  );
  let t = 0;
  const events = [];
  [...call].forEach((c, i) => {
    [...MORSE[c]].forEach((s, j) => {
      const duration = dot * (s === "-" ? 3 : 1);
      events.push({ at: t, duration });
      t += duration;
      if (j < MORSE[c].length - 1) t += dot;
    });
    if (i < call.length - 1) t += 3 * gapUnit;
  });
  return { events, duration: t };
}
let ctx,
  radio,
  localKeyer,
  voiceReady = false,
  starting = false,
  running = false,
  loadingVoice = false,
  phase = "idle",
  current = "",
  attempted = false,
  epoch = 0,
  correct = 0,
  total = 0,
  streak = 0,
  lastCall = "",
  nodes = new Set();
const screenAwake = new PracticeWakeLock((state, supported) => {
  const button = $("wakeStatus");
  const labels = {
    idle: "Screen sleep allowed",
    waiting: "Keep awake paused",
    requesting: "Keeping screen awake…",
    locked: "Screen stays awake",
    released: "Keep awake · retry",
    blocked: "Keep awake · retry",
    unsupported: "Keep awake unavailable",
  };
  button.textContent = labels[state];
  button.dataset.state = state;
  button.disabled = !["released", "blocked"].includes(state);
  button.title =
    state === "locked"
      ? "The screen will stay on while this session is active."
      : !supported
        ? "Screen wake lock is unavailable here. Try opening this page in Safari or Chrome."
        : ["released", "blocked"].includes(state)
          ? "Your browser or power-saving settings may block keeping the screen on. Tap to retry."
          : "The screen is kept awake automatically during practice and model loading.";
});
const syncKeepAwake = () =>
  screenAwake.setActive(starting || running || loadingVoice);
$("wakeStatus").onclick = () => screenAwake.acquire();
window.addEventListener("focus", () => {
  if (starting || running || loadingVoice) screenAwake.acquire();
});
const localVoice = new LocalVoice((state, value) => {
  if (state === "ready") {
    $("voiceTitle").textContent = "Vosk ready · running on this device";
    $("voiceInfo").textContent =
      "Letters, digits, and phonetic words. No audio uploads.";
    $("install").hidden = true;
  } else if (state === "progress") {
    $("voiceTitle").textContent = "Downloading model · " + value + "%";
    $("voiceInfo").textContent =
      value === 100
        ? "Download complete. Preparing local recognition…"
        : "One-time download, about 40 MB. Keep this page open.";
  } else if (state === "loading") {
    $("voiceTitle").textContent = "Loading local voice…";
    $("voiceInfo").textContent =
      "Restoring the cached model, or downloading it on first use.";
  } else if (state === "error") {
    $("voiceTitle").textContent = "Voice setup needs another try";
    $("voiceInfo").textContent = value;
    $("install").hidden = false;
  }
});
$("signal").innerHTML = Array.from({ length: 31 }, () => "<span></span>").join(
  "",
);
function syncPracticeControls() {
  const active = starting || running;
  $("start").hidden = active;
  for (const id of ["replay", "reveal", "pause"]) {
    $(id).hidden = !active;
  }
}
function setPhase(next, title, instruction) {
  phase = next;
  $("headline").textContent = title;
  $("instruction").textContent = instruction;
  const names = {
    loading: $("inputMode").value === "keyer" ? "Preparing local Morse decoder" : "Preparing local voice",
    idle: "Standing by",
    playing:
      $("inputMode").value === "voice"
        ? "Playing + listening"
        : "Receiving Morse",
    listening: "Your turn · listening",
    typing: "Your turn · copy",
    feedback: "Copy checked",
    revealed: "Call sign revealed",
    paused: "Session paused",
  };
  $("statusLabel").textContent = names[next] || next;
  $("signal").classList.toggle(
    "active",
    next === "playing" || next === "listening",
  );
  syncPracticeControls();
  $("answer").disabled = next !== "typing";
  $("submit").disabled = next !== "typing";
  $("answerForm").hidden = !running || $("inputMode").value !== "type";
}
function stats() {
  $("correct").textContent = correct;
  $("accuracy").textContent = total
    ? Math.round((correct / total) * 100) + "%"
    : "—";
  $("streak").textContent = streak;
}
function silence() {
  if (radio) {
    radio.stop();
    radio = null;
  }
  for (const n of nodes) {
    try {
      n.stop();
    } catch {}
  }
  nodes.clear();
}
function stopListening() {
  localVoice.stop();
  localKeyer?.stop();
}
function invalidate() {
  epoch++;
  stopListening();
  silence();
  return epoch;
}
async function audio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  await ctx.resume();
  if (ctx.state !== "running")
    throw Error("Audio is paused. Tap Start or Repeat to enable it.");
}
function tone(hz, at, duration, level = 0.2, destination) {
  const osc = ctx.createOscillator(),
    gain = ctx.createGain();
  osc.frequency.value = hz;
  osc.connect(gain);
  gain.connect(destination || ctx.destination);
  const volume = destination ? 1 : Number($("volume").value) / 100;
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(level * volume, at + 0.005);
  gain.gain.setValueAtTime(
    level * volume,
    at + Math.max(0.006, duration - 0.008),
  );
  gain.gain.linearRampToValueAtTime(0, at + duration);
  osc.start(at);
  osc.stop(at + duration + 0.02);
  nodes.add(osc);
  osc.onended = () => {
    nodes.delete(osc);
    osc.disconnect();
    gain.disconnect();
  };
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
function clearCopy() {
  $("call").textContent = "· · ·   − − −   · · ·";
  $("call").classList.remove("revealed");
  $("call").setAttribute("aria-label", "Call sign hidden");
  $("answer").value = "";
}
async function play() {
  const token = invalidate();
  if (!running) return;
  clearCopy();
  $("feedback").textContent = "Listen for the whole call sign.";
  setPhase(
    "playing",
    "Listen. You’ve got this.",
    "Copy the letters and numbers in your head.",
  );
  try {
    await audio();
    if (token !== epoch) return;
    const seq = timings(current, +$("speed").value, +$("spacing").value);
    const captureVoice = $("inputMode").value === "voice" && voiceReady;
    if (captureVoice) answerTurn(token, true);
    if (token !== epoch || !running) return;
    const start = ctx.currentTime + 0.15;
    const settings = {
      staticLevel: +$("staticLevel").value,
      interference: +$("interference").value,
      fading: +$("fading").value,
      volume: +$("volume").value / 100,
      hz: +$("tone").value,
    };
    if (settings.staticLevel || settings.interference || settings.fading)
      radio = new RadioEnvironment(ctx, start, seq.duration, settings);
    seq.events.forEach((e) =>
      tone(settings.hz, start + e.at, e.duration, 0.2, radio?.input),
    );
    await delay((seq.duration + 0.4) * 1000);
    if (token !== epoch || !running) return;
    // Release fading-only graphs too, without running a silent audio source.
    if (radio) {
      radio.stop();
      radio = null;
    }
    if (
      captureVoice &&
      $("inputMode").value === "voice" &&
      localVoice.finishPlayback
    ) {
      setPhase(
        "listening",
        "Finish your copy.",
        "Keep speaking, or say the call sign now.",
      );
      localVoice.finishPlayback();
    } else answerTurn(token);
  } catch (e) {
    if (token === epoch) {
      endSession();
      $("feedback").textContent = e.message;
    }
  }
}
function keyboardTurn(message) {
  stopListening();
  localVoice.closeMicrophone();
  localKeyer?.closeMicrophone();
  $("inputMode").value = "type";
  $("modeBadge").textContent = "KEYBOARD";
  $("inputNote").textContent = "Type the complete call sign, then press Enter.";
  updateVoiceMode();
  setPhase(
    "typing",
    "What did you hear?",
    "Type the letters and numbers of the call sign.",
  );
  if (message) $("feedback").textContent = message;
  $("answer").focus();
}
function answerTurn(token, duringPlayback = false) {
  if ($("inputMode").value === "keyer") {
    keyerTurn(token);
    return;
  }
  if ($("inputMode").value === "type" || !voiceReady) {
    keyboardTurn();
    return;
  }
  if (duringPlayback)
    setPhase(
      "playing",
      "Listen and say your copy.",
      "You can speak the letters and numbers as Morse plays.",
    );
  else
    setPhase(
      "listening",
      "Your turn. Say your copy.",
      "Say the complete call sign in one phrase.",
    );
  $("feedback").textContent =
    "Listening locally… letters, numbers, or phonetic words.";
  const valid = () => token === epoch && running;
  try {
    localVoice.listen({
      deferResult: duringPlayback,
      isComplete: (text) => valid() && normalize(text) === current,
      onReplay: () => {
        if (valid()) play();
      },
      onResult: (text) => {
        if (valid()) check(text);
      },
      onPartial: (text) => {
        if (valid())
          $("feedback").textContent = text
            ? "Hearing: " + text
            : "Listening on your device…";
      },
      onEmpty: () => {
        if (valid()) {
          setPhase(
            "listening",
            "No speech heard.",
            "Tap Repeat when you’re ready to try again.",
          );
          $("feedback").textContent =
            "No attempt counted. Your microphone is still connected.";
        }
      },
      onError: (error) => {
        if (valid())
          keyboardTurn(
            error.message +
              " Continue with the keyboard, or restart voice practice.",
          );
      },
    });
  } catch (error) {
    if (valid()) keyboardTurn(error.message);
  }
}
function keyerTurn(token) {
  setPhase("listening", "Your turn. Send your copy.",
    "Send the call sign on your external keyer. Your answer is checked automatically.");
  $("feedback").textContent = "Listening for keyer audio. Keep the microphone near its speaker.";
  const valid = () => token === epoch && running;
  try {
    localKeyer.listen({
      isComplete: (text) => valid() && text.toUpperCase().replace(/\s/g, "") === current,
      onPartial: (text) => {
        if (valid()) $("feedback").textContent = text ? "Decoding: " + text : "Listening for Morse…";
      },
      onResult: (text) => { if (valid()) check(text, true); },
      onEmpty: () => {
        if (!valid()) return;
        $("feedback").textContent = "No Morse decoded. No attempt counted. Tap Repeat to try again.";
      },
      onError: (error) => {
        if (valid()) keyboardTurn(error.message + " Continue with the keyboard, or restart keyer practice.");
      },
    });
  } catch (error) {
    if (valid()) keyboardTurn(error.message);
  }
}
async function check(spoken, morse = false) {
  if (!running) return;
  const copy = morse ? (spoken || "").toUpperCase().replace(/\s/g, "") : normalize(spoken || "");
  if (
    !["typing", "listening"].includes(phase) &&
    !(phase === "playing" && copy === current)
  ) return;
  if (/\brepeat\b/i.test(spoken || "")) {
    play();
    return;
  }
  if (!copy) return;
  const token = invalidate();
  const good = copy === current;
  total++;
  if (good) {
    correct++;
    streak++;
  } else {
    streak = 0;
    attempted = true;
  }
  stats();
  setPhase(
    "feedback",
    good ? "Good copy. Nicely done." : "Not quite. Listen again.",
    good
      ? "A new call sign is coming up."
      : "Same call sign. Another chance to catch it.",
  );
  $("feedback").textContent =
    "Your copy: " + copy + (good ? " · Correct" : " · Try again");
  if (good) {
    $("call").textContent = current;
    $("call").classList.add("revealed");
    $("call").setAttribute("aria-label", current);
  }
  try {
    await audio();
    if (token !== epoch) return;
    const t = ctx.currentTime + 0.05;
    if (good) {
      tone(880, t, 0.14, 0.24);
      tone(1174.66, t + 0.15, 0.3, 0.18);
    } else {
      tone(220, t, 0.42, 0.25);
      tone(164.81, t + 0.09, 0.4, 0.15);
    }
  } catch {}
  await delay(good ? 1400 : 1800);
  if (token !== epoch || !running) return;
  if (good) newCall();
  play();
}
function newCall() {
  let next;
  do {
    next = generateCall($("format").value, $("includeInternational").value !== "no");
  } while (next === lastCall);
  current = next;
  lastCall = next;
  attempted = false;
}
function endSession() {
  running = false;
  starting = false;
  syncKeepAwake();
  invalidate();
  localVoice.closeMicrophone();
  localKeyer?.closeMicrophone();
  $("answerForm").hidden = true;
  setPhase(
    "paused",
    "A good place to pause.",
    "Your session stats stay here. Start again whenever you like.",
  );
  $("feedback").textContent = "73. See you on the next frequency.";
}
$("start").onclick = async () => {
  if (running || starting) return;
  starting = true;
  syncKeepAwake();
  const token = invalidate();
  syncPracticeControls();
  try {
    await audio();
    if (token !== epoch) return;
    if ($("inputMode").value === "voice") {
      if (!localVoice.supported)
        throw new Error(
          "Local voice needs microphone access, WebAssembly, and AudioWorklet support. Select Keyboard to practice here.",
        );
      setPhase(
        "loading",
        "Getting your station ready.",
        "Loading the local speech model. First use downloads about 40 MB.",
      );
      await localVoice.load();
      if (token !== epoch) return;
      $("feedback").textContent =
        "Allow microphone access to begin. Audio stays on your device.";
      const opened = await localVoice.openMicrophone(ctx);
      if (token !== epoch || !opened) return;
    }
    if ($("inputMode").value === "keyer") {
      localKeyer ||= new LocalKeyer();
      if (!localKeyer.supported) throw Error("Keyer audio needs microphone access, WebAssembly, and AudioWorklet support. Select Keyboard to practice here.");
      setPhase("loading", "Getting your keyer station ready.",
        "Loading DeepCW and its runtime, about 26 MB on first use. Audio stays on this device.");
      await localKeyer.load();
      if (token !== epoch) return;
      $("feedback").textContent = "Allow microphone access, then wait for your turn to send.";
      const opened = await localKeyer.openMicrophone(ctx);
      if (token !== epoch || !opened) return;
    }
    if (token !== epoch) return;
    starting = false;
    running = true;
    newCall();
    play();
  } catch (error) {
    if (token !== epoch) return;
    endSession();
    $("feedback").textContent =
      error.name === "NotAllowedError"
        ? "Microphone permission was not granted. Allow access in your browser settings, or select Keyboard."
        : error.message;
  }
};
$("pause").onclick = endSession;
$("replay").onclick = () => {
  if (running) play();
};
$("answerForm").onsubmit = (e) => {
  e.preventDefault();
  check($("answer").value);
};
$("reveal").onclick = () => {
  if (!running) return;
  invalidate();
  if (!attempted) {
    total++;
    streak = 0;
    attempted = true;
    stats();
  }
  $("call").textContent = current;
  $("call").classList.add("revealed");
  $("call").setAttribute("aria-label", current);
  setPhase(
    "revealed",
    "Here’s that call sign.",
    "Tap Repeat to listen again, then copy it back.",
  );
  $("feedback").textContent =
    "Reveal counted as a miss. Keep practicing this call sign.";
};
const settingIds = [
  "speed", "spacing", "tone", "volume", "staticLevel", "interference", "fading",
  "format", "inputMode", "includeInternational",
];
for (const name of settingIds.filter((id) => !["format", "inputMode", "includeInternational"].includes(id))) {
  $(name).oninput = () => {
    if (name === "speed") {
      $("spacing").max = $("speed").value;
      if (+$("spacing").value > +$("speed").value)
        $("spacing").value = $("speed").value;
    }
    $("speedValue").textContent = $("speed").value;
    $("spacingValue").textContent = $("spacing").value;
    $("toneValue").textContent = $("tone").value;
    $("volumeValue").textContent = $("volume").value;
    for (const id of ["staticLevel", "interference", "fading"])
      $(id + "Value").textContent = $(id).value || "0";
    saveSettings();
  };
}
function saveSettings() {
  try {
    localStorage.setItem(
      "morse-copy-settings",
      JSON.stringify(
        Object.fromEntries(
          settingIds.map(
            (id) => [id, $(id).value],
          ),
        ),
      ),
    );
  } catch {}
}
try {
  const saved = JSON.parse(
    localStorage.getItem("morse-copy-settings") || "null",
  );
  if (saved) {
    if (saved.speed) $("spacing").max = saved.speed;
    for (const id of settingIds)
      if (saved[id] !== undefined) $(id).value = saved[id];
    $("speed").oninput();
  }
} catch {}
$("format").onchange = saveSettings;
$("includeInternational").onchange = saveSettings;
function updateVoiceMode() {
  const voice = $("inputMode").value === "voice";
  const keyer = $("inputMode").value === "keyer";
  $("modeBadge").textContent = keyer ? "DEEPCW · ON DEVICE" : voice ? "VOSK · ON DEVICE" : "KEYBOARD";
  $("answerSummary").textContent = keyer ? "External keyer" : voice ? "Voice" : "Keyboard";
  $("keyerInfo").hidden = !keyer;
  $("voiceBox").hidden = !voice;
  $("inputNote").textContent = keyer
    ? "Keyer audio is decoded locally after playback. Answers are checked automatically."
    : voice
    ? "Listening during Morse and your answer. Audio stays local."
    : "Type the complete call sign, then press Enter.";
  if (!running && !starting && phase === "idle")
    $("instruction").textContent = keyer
      ? "Press start, listen, then send the call sign with your external keyer."
      : voice
      ? "Press start and speak the letters as Morse plays, or answer afterwards."
      : "Press start, listen to the Morse code, then type the letters and numbers.";
}
$("inputMode").onchange = () => {
  if (running || starting) {
    endSession();
    $("feedback").textContent =
      "Answer mode changed. Press Start practice to begin.";
  }
  saveSettings();
  updateVoiceMode();
};
$("install").onclick = async () => {
  loadingVoice = true;
  syncKeepAwake();
  $("install").disabled = true;
  $("install").textContent = "Loading voice…";
  try {
    await localVoice.load();
    if (!running && !starting) {
      $("inputMode").value = "voice";
      updateVoiceMode();
      saveSettings();
    }
  } catch (error) {
    $("voiceInfo").textContent = error.message;
  } finally {
    loadingVoice = false;
    syncKeepAwake();
    $("install").disabled = false;
    $("install").textContent = "Load local voice · about 40 MB";
  }
};
voiceReady = localVoice.supported;
$("inputMode").options[0].disabled = !voiceReady;
if (!voiceReady) {
  $("inputMode").value = "type";
  $("voiceTitle").textContent = "Local voice is unavailable here";
  $("voiceInfo").textContent =
    "Open this page in a browser with microphone access, WebAssembly, and AudioWorklet support.";
  $("install").hidden = true;
} else {
  $("voiceTitle").textContent = "Local voice · model ready to load";
  $("voiceInfo").textContent =
    "First use downloads about 40 MB. Recognition runs on this device.";
  $("install").hidden = false;
}
updateVoiceMode();
document.addEventListener("visibilitychange", () => {
  if (document.hidden && (running || starting)) endSession();
});
window.addEventListener("pagehide", () => {
  screenAwake.setActive(false);
  localVoice.closeMicrophone();
  localKeyer?.closeMicrophone();
});
