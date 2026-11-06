"use strict";
// Microphone transport is independent of the speech model and recognition grammar.
class LocalKeyer {
  constructor() {
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
    if (this.loading) return this.loading;
    this.loading = new Promise((resolve, reject) => {
      this.worker = new Worker("deepcw-worker.js");
      const fail = (error) => {
        clearTimeout(this.loadTimeout);
        this.worker?.terminate();
        this.worker = null;
        this.loading = null;
        reject(error);
        this.onError?.(error);
      };
      this.loadTimeout = setTimeout(
        () =>
          fail(Error("DeepCW loading timed out. Restart practice to retry.")),
        120000,
      );
      this.worker.onerror = () =>
        fail(Error("DeepCW stopped. Restart practice to retry."));
      this.worker.onmessage = ({ data }) => {
        if (data.type === "ready") {
          clearTimeout(this.loadTimeout);
          resolve();
          return;
        }
        if (data.type === "error" && data.id === undefined) {
          fail(Error(data.message));
          return;
        }
        if (data.id !== this.captureId) return;
        if (data.type === "partial" && this.callbacks) {
          this.callbacks.onPartial(data.text);
          if (data.text && this.callbacks?.isComplete?.(data.text)) {
            const onResult = this.callbacks.onResult;
            this.stop();
            onResult(data.text);
            return;
          }
          if (data.text && data.text !== this.lastText) {
            this.lastText = data.text;
            this.armSilence();
          }
        }
        if (data.type === "result" || data.type === "error") {
          const callbacks = this.callbacks;
          this.stop();
          if (data.type === "error") callbacks?.onError(Error(data.message));
          else if (data.text.trim()) callbacks?.onResult(data.text);
          else callbacks?.onEmpty();
        }
      };
      this.worker.postMessage({ type: "load" });
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
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
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
        if (data.id === this.captureId && this.callbacks) {
          if (
            !this.finishing &&
            LocalKeyer.hasTone(data.samples, context.sampleRate)
          ) {
            this.armSilence();
          }
          this.worker.postMessage(
            { type: "samples", id: data.id, samples: data.samples },
            [data.samples.buffer],
          );
        }
        if (
          data.flushed === this.captureId &&
          this.callbacks &&
          this.finishing
        ) {
          this.worker.postMessage({ type: "finish", id: this.captureId });
          this.flushTimeout = setTimeout(() => {
            const onError = this.callbacks?.onError;
            this.stop();
            onError?.(
              Error("DeepCW decoding timed out. Tap Repeat to try again."),
            );
          }, 60000);
        }
      };
      stream.getAudioTracks()[0].onended = () =>
        this.onError?.(
          Error("Microphone disconnected. Restart keyer practice."),
        );
      return true;
    } catch (error) {
      if (id === this.micId) this.closeMicrophone();
      else stream?.getTracks().forEach((t) => t.stop());
      throw error;
    }
  }
  listen(callbacks) {
    this.stop();
    if (!this.worker || !this.stream?.active)
      throw Error("Keyer microphone is not ready. Restart practice.");
    this.callbacks = callbacks;
    this.onError = callbacks.onError;
    this.finishing = false;
    this.lastText = "";
    this.worker.postMessage({
      type: "start",
      id: this.captureId,
      rate: this.context.sampleRate,
    });
    this.node.port.postMessage({ active: this.captureId });
    this.timeout = setTimeout(() => this.finish(), 60000);
  }
  // A concentrated tone in the model's frequency range extends the answer window.
  // Speech-style noise suppression is disabled because it can remove keyer tones.
  static hasTone(samples, rate) {
    const count = Math.floor((samples.length * 3200) / rate);
    if (count < 32) return false;
    const signal = new Float32Array(count);
    let energy = 0;
    for (let i = 0; i < count; i++) {
      signal[i] = samples[Math.floor((i * rate) / 3200)];
      energy += signal[i] * signal[i];
    }
    if (energy / count < 2.5e-7) return false;
    for (let hz = 400; hz <= 1200; hz += 25) {
      const coefficient = 2 * Math.cos((2 * Math.PI * hz) / 3200);
      let previous = 0,
        before = 0;
      for (const sample of signal) {
        const next = sample + coefficient * previous - before;
        before = previous;
        previous = next;
      }
      const power =
        previous * previous + before * before - coefficient * previous * before;
      if (power / (count * energy) > 0.15) return true;
    }
    return false;
  }
  armSilence() {
    clearTimeout(this.silenceTimeout);
    if (this.lastText && !this.finishing)
      this.silenceTimeout = setTimeout(() => this.finish(), 1800);
  }
  finish() {
    if (!this.callbacks || this.finishing) return;
    this.finishing = true;
    clearTimeout(this.timeout);
    clearTimeout(this.silenceTimeout);
    // Ask the worklet to flush its last partial buffer before final inference.
    this.node.port.postMessage({ flush: this.captureId });
  }
  stop() {
    this.captureId++;
    clearTimeout(this.timeout);
    clearTimeout(this.flushTimeout);
    clearTimeout(this.silenceTimeout);
    this.callbacks = null;
    this.onError = null;
    this.finishing = false;
    this.node?.port.postMessage({ active: null });
    this.worker?.postMessage({ type: "stop" });
  }
  closeMicrophone() {
    this.micId++;
    this.stop();
    this.source?.disconnect();
    this.node?.disconnect();
    if (this.node) this.node.port.onmessage = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = this.source = this.node = null;
  }
}
window.LocalKeyer = LocalKeyer;
