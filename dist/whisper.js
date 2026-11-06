"use strict";
// Reuse the existing microphone/worklet lifecycle; Vosk recognition is untouched.
class WhisperVoice extends window.LocalVoice {
  constructor(onStatus) {
    super(onStatus);
    this.requests = new Map();
    this.requestId = 0;
  }
  request(message, timeout = 90000) {
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // A stalled WASM job cannot be interrupted inside its worker.
        this.dispose(new Error("Whisper took too long. Try again or switch to Vosk."));
      }, timeout);
      this.requests.set(id, { resolve, reject, timer });
      this.worker.postMessage({ ...message, id }, message.samples ? [message.samples.buffer] : []);
    });
  }
  load() {
    if (this.model?.ready) return Promise.resolve(this.model);
    if (this.loading) return this.loading;
    this.onStatus("loading");
    this.loading = Promise.resolve().then(async () => {
      try {
        this.worker = new Worker("whisper-worker.js", { type: "module" });
        this.worker.onmessage = ({ data }) => {
          if (data.type === "progress") {
            this.onStatus("progress", data.percent);
            return;
          }
          const job = this.requests.get(data.id);
          if (!job) return;
          clearTimeout(job.timer);
          this.requests.delete(data.id);
          data.error ? job.reject(new Error(data.error)) : job.resolve(data);
        };
        this.worker.onerror = (event) => {
          event.preventDefault();
          const error = new Error("Whisper could not run. Check your connection or switch to Vosk.");
          const onError = this.onError;
          this.dispose(error);
          this.onStatus("error", error.message);
          onError?.(error);
        };
        await this.request({ type: "load" }, 240000);
        this.model = { ready: true };
        this.onStatus("ready");
        return this.model;
      } catch (error) {
        this.dispose(error);
        this.onStatus("error", error.message);
        throw error;
      }
    });
    return this.loading;
  }
  listen({ onResult, onPartial, onEmpty, onError, onReplay, isComplete, deferResult = false }) {
    this.stop();
    if (!this.model?.ready || !this.stream?.active)
      throw new Error("Whisper is not ready. Restart practice.");
    const id = this.captureId;
    const rate = this.context.sampleRate;
    let chunks = [], length = 0, silence = 0, spoken = false;
    let busy = false, expired = false, canComplete = !deferResult, segments = [];
    let preRoll = [];
    const active = () => id === this.captureId;
    const complete = () => {
      if (!active()) return;
      const text = segments.join(" ").trim();
      this.stop();
      text ? onResult(text) : onEmpty();
    };
    const fail = (error) => {
      if (!active()) return;
      this.stop();
      onError(error);
    };
    const maybeComplete = () => {
      if (!active() || busy || spoken) return;
      if (canComplete && (segments.length || expired)) complete();
    };
    const flush = async () => {
      if (!active() || busy || !spoken) return;
      const pcm = new Float32Array(length);
      let offset = 0;
      for (const chunk of chunks) { pcm.set(chunk, offset); offset += chunk.length; }
      chunks = []; length = 0; silence = 0; spoken = false; busy = true;
      try {
        const result = await this.request({ type: "transcribe", samples: WhisperVoice.resample(pcm, rate) });
        if (!active()) return;
        busy = false;
        if (result.text) segments.push(result.text);
        const text = segments.join(" ");
        if (onReplay && /\brepeat\b/i.test(result.text)) {
          this.stop(); onReplay(); return;
        }
        if (text && isComplete?.(text)) { complete(); return; }
        onPartial(text);
        if (spoken && (expired || silence >= rate * 1.2 || length >= rate * 20)) flush();
        else maybeComplete();
      } catch (error) { fail(error); }
    };
    this.onError = fail;
    this.recognizer = {
      remove() {},
      acceptWaveformFloat: (samples) => {
        if (!active() || expired) return;
        let power = 0;
        for (const sample of samples) power += sample * sample;
        const speech = Math.sqrt(power / samples.length) > 0.012;
        if (!spoken && !speech) {
          // Retain ~250ms to avoid clipping the first consonant.
          preRoll.push(samples);
          while (preRoll.length * samples.length > rate * 0.25) preRoll.shift();
          return;
        }
        if (!spoken) {
          chunks.push(...preRoll);
          length += preRoll.reduce((sum, chunk) => sum + chunk.length, 0);
          preRoll = [];
          spoken = true;
        }
        chunks.push(samples); length += samples.length;
        silence = speech ? 0 : silence + samples.length;
        if (silence >= rate * 1.2 || length >= rate * 20) flush();
        // Bound buffered audio while a slow phone is still transcribing.
        if (length > rate * 25) fail(new Error("Whisper cannot keep up on this device. Try Vosk."));
      },
    };
    this.node.port.postMessage({ active: id });
    const armTimeout = () => {
      this.timeout = setTimeout(() => {
        if (!active()) return;
        expired = true;
        this.node.port.postMessage({ active: null });
        if (!busy && spoken) flush();
        else maybeComplete();
      }, 18000);
    };
    this.finishPlayback = () => {
      if (!active() || canComplete) return;
      canComplete = true;
      armTimeout();
      maybeComplete();
    };
    if (canComplete) armTimeout();
  }
  dispose(error = new Error("Whisper was closed.")) {
    this.closeMicrophone();
    this.worker?.terminate();
    this.worker = null;
    for (const job of this.requests.values()) {
      clearTimeout(job.timer);
      job.reject(error);
    }
    this.requests.clear();
    this.model = null;
    this.loading = null;
  }
  static resample(samples, rate) {
    // Average source intervals to reduce aliasing when downsampling to 16 kHz.
    const ratio = rate / 16000;
    const output = new Float32Array(Math.floor(samples.length / ratio));
    for (let i = 0; i < output.length; i++) {
      const start = Math.floor(i * ratio), end = Math.floor((i + 1) * ratio);
      let sum = 0;
      for (let j = start; j < end; j++) sum += samples[j];
      output[i] = end > start ? sum / (end - start) : samples[start];
    }
    return output;
  }
}
window.WhisperVoice = WhisperVoice;
