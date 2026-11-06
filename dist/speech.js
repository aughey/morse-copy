"use strict";
// Same grammar for every call sign. Never bias recognition toward the answer.
const VOICE_VOCABULARY = [
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
  "v",
  "w",
  "x",
  "y",
  "z",
  "zero",
  "oh",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "niner",
  "alpha",
  "alfa",
  "bravo",
  "charlie",
  "delta",
  "echo",
  "foxtrot",
  "golf",
  "hotel",
  "india",
  "juliet",
  "juliett",
  "kilo",
  "lima",
  "mike",
  "november",
  "nancy",
  "oscar",
  "papa",
  "quebec",
  "romeo",
  "sierra",
  "sugar",
  "tango",
  "uniform",
  "victor",
  "whiskey",
  "x ray",
  "yankee",
  "zulu",
  "double you",
  "double u",
  "zed",
  "bee",
  "see",
  "dee",
  "gee",
  "jay",
  "kay",
  "el",
  "em",
  "en",
  "pee",
  "cue",
  "are",
  "ess",
  "tee",
  "you",
  "vee",
  "ex",
  "why",
  "zee",
  "repeat",
  "[unk]",
];
class LocalVoice {
  constructor(onStatus) {
    this.onStatus = onStatus;
    this.model = null;
    this.loading = null;
    this.captureId = 0;
    this.micId = 0;
    this.workletContexts = new WeakSet();
  }
  get supported() {
    return !!(
      window.WebAssembly &&
      window.Worker &&
      window.AudioWorkletNode &&
      navigator.mediaDevices?.getUserMedia
    );
  }
  load() {
    if (this.model?.ready) return Promise.resolve(this.model);
    if (this.loading) return this.loading;
    this.loading = new Promise((resolve, reject) => {
      let model,
        settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) {
          model?.terminate();
          this.loading = null;
          this.onStatus("error", error.message);
          reject(error);
        } else {
          this.model = model;
          this.onStatus("ready");
          resolve(model);
        }
      };
      const timeout = setTimeout(
        () =>
          finish(
            new Error(
              "Voice setup timed out. Please try loading the model again.",
            ),
          ),
        120000,
      );
      try {
        this.onStatus("loading");
        model = new Vosk.Model(
          new URL("models/vosk-en-us-0.15.tar.gz", location.href).href,
          -1,
        );
        model.on("load", (message) =>
          finish(
            message.result
              ? null
              : new Error("The voice model could not be loaded. Please retry."),
          ),
        );
        model.on("error", (message) => {
          if (!settled)
            finish(new Error("Local voice setup failed: " + message.error));
          else {
            const onError = this.onError;
            this.model = null;
            this.loading = null;
            model.terminate();
            this.onStatus(
              "error",
              "Local recognition stopped. Reload the model to try again.",
            );
            onError?.(
              new Error(
                "Local speech recognition stopped. Please restart voice practice.",
              ),
            );
          }
        });
        let lastPercent = -1;
        model.on("downloadprogress", (message) => {
          const percent = Math.floor((message.loaded / message.total) * 100);
          if (percent !== lastPercent) {
            lastPercent = percent;
            this.onStatus("progress", percent);
          }
        });
      } catch (error) {
        finish(error);
      }
    });
    return this.loading;
  }
  async openMicrophone(context) {
    this.closeMicrophone();
    const id = this.micId;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (id !== this.micId) {
        stream.getTracks().forEach((t) => t.stop());
        return false;
      }
      this.stream = stream;
      if (!this.workletContexts.has(context)) {
        await context.audioWorklet.addModule("mic-worklet.js");
        this.workletContexts.add(context);
      }
      if (id !== this.micId) return false;
      await context.resume();
      if (id !== this.micId) return false;
      this.context = context;
      this.node = new AudioWorkletNode(context, "morse-microphone");
      this.source = context.createMediaStreamSource(stream);
      this.source.connect(this.node);
      this.node.connect(context.destination);
      this.node.port.onmessage = ({ data }) => {
        if (data.id === this.captureId && this.recognizer) {
          try {
            this.recognizer.acceptWaveformFloat(
              data.samples,
              context.sampleRate,
            );
          } catch (error) {
            this.onError?.(error);
          }
        }
      };
      stream.getAudioTracks()[0].onended = () =>
        this.onError?.(
          new Error("Microphone disconnected. Please restart voice practice."),
        );
      return true;
    } catch (error) {
      if (id === this.micId) this.closeMicrophone();
      else stream?.getTracks().forEach((t) => t.stop());
      throw error;
    }
  }
  listen({ onResult, onPartial, onEmpty, onError, onReplay, deferResult = false }) {
    this.stop();
    if (!this.model?.ready || !this.stream?.active)
      throw new Error("Local voice is not ready. Restart practice.");
    const id = this.captureId;
    const recognizer = new this.model.KaldiRecognizer(
      this.context.sampleRate,
      JSON.stringify(VOICE_VOCABULARY),
    );
    this.recognizer = recognizer;
    this.onError = onError;
    let finalRequested = false,
      done = false,
      segments = [],
      canComplete = !deferResult,
      settled = false;
    const complete = (text) => {
      if (done || id !== this.captureId) return;
      done = true;
      this.stop();
      text ? onResult(text) : onEmpty();
    };
    // Commands bypass both the silence timer and deferred scoring during Morse.
    const replay = (text) => {
      if (!onReplay || !/\brepeat\b/i.test(text)) return false;
      done = true;
      this.stop();
      onReplay();
      return true;
    };
    recognizer.on("result", (message) => {
      if (id !== this.captureId) return;
      const text = message.result?.text?.trim() || "";
      if (replay(text)) return;
      if (text) segments.push(text);
      if (finalRequested) {
        complete(segments.join(" "));
        return;
      }
      if (text) {
        settled = false;
        clearTimeout(this.settleTimeout);
        this.settleTimeout = setTimeout(() => {
          settled = true;
          if (canComplete) complete(segments.join(" "));
        }, 1200);
      }
    });
    recognizer.on("partialresult", (message) => {
      if (id !== this.captureId) return;
      const partial = message.result?.partial || "";
      if (replay(partial)) return;
      if (partial) {
        settled = false;
        clearTimeout(this.settleTimeout);
      }
      onPartial([...segments, partial].filter(Boolean).join(" "));
    });
    recognizer.on("error", (message) => {
      if (id === this.captureId) {
        this.stop();
        onError(new Error(message.error || "Local recognition error"));
      }
    });
    this.node.port.postMessage({ active: id });
    const armTimeout = () => {
      this.timeout = setTimeout(() => {
        if (id !== this.captureId) return;
        finalRequested = true;
        this.node.port.postMessage({ active: null });
        recognizer.retrieveFinalResult();
        this.flushTimeout = setTimeout(() => {
          if (id === this.captureId) {
            this.stop();
            onError(
              new Error("Recognition took too long. Tap Replay to try again."),
            );
          }
        }, 8000);
      }, 18000);
    };
    // Collect everything spoken during Morse, including pauses between letters.
    // Score only after playback ends, and allow a full answer window afterwards.
    this.finishPlayback = () => {
      if (id !== this.captureId || canComplete) return;
      canComplete = true;
      if (settled && segments.length) complete(segments.join(" "));
      else armTimeout();
    };
    if (canComplete) armTimeout();
  }
  stop() {
    this.captureId++;
    clearTimeout(this.timeout);
    clearTimeout(this.flushTimeout);
    clearTimeout(this.settleTimeout);
    this.timeout = null;
    this.finishPlayback = null;
    this.node?.port.postMessage({ active: null });
    if (this.recognizer) {
      this.recognizer.remove();
      this.recognizer = null;
    }
  }
  closeMicrophone() {
    this.micId++;
    this.stop();
    this.onError = null;
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.disconnect();
      this.node = null;
    }
    this.source?.disconnect();
    this.source = null;
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.stream = null;
  }
}
window.LocalVoice = LocalVoice;
