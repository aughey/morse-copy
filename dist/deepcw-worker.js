"use strict";
importScripts("vendor/ort/ort.wasm.min.js", "deepcw-core.js");
ort.env.wasm.numThreads = 1; // Works on Pages without cross-origin isolation.
ort.env.wasm.wasmPaths = new URL("vendor/ort/", self.location.href).href;
let session,
  metadata,
  capture,
  inferencing = false;

async function pump(turn) {
  if (turn.busy || inferencing || capture !== turn) return;
  inferencing = true;
  turn.busy = true;
  try {
    while (capture === turn) {
      const count = turn.length;
      const isFinal = turn.final;
      if (!turn.final && count - turn.processed < turn.rate) break;
      if (!turn.final && count < turn.rate * 2) break;
      let audio = resampleLinear(
        turn.audio.subarray(0, count),
        turn.rate,
        metadata.sample_rate,
      );
      if (isFinal) {
        const padded = new Float32Array(audio.length + metadata.sample_rate);
        padded.set(audio);
        audio = padded;
        await turn.decoder.finalize(audio);
      } else {
        await turn.decoder.step(audio, audio.length);
      }
      if (capture !== turn) return;
      turn.processed = count;
      postMessage({
        type: isFinal ? "result" : "partial",
        id: turn.id,
        text: turn.decoder.transcript + (isFinal ? "" : turn.decoder.pending),
      });
      if (isFinal) {
        capture = null;
        break;
      }
    }
  } catch (error) {
    if (capture === turn) {
      capture = null;
      postMessage({
        type: "error",
        id: turn.id,
        message: error.message || String(error),
      });
    }
  } finally {
    turn.busy = false;
    inferencing = false;
    if (capture && capture !== turn) pump(capture);
  }
}
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "load") {
      const response = await fetch("models/deepcw.onnx.json");
      if (!response.ok) throw Error("Cannot load DeepCW metadata.");
      metadata = await response.json();
      session = await ort.InferenceSession.create("models/deepcw.onnx", {
        executionProviders: ["wasm"],
      });
      postMessage({ type: "ready" });
    } else if (data.type === "start") {
      capture = {
        id: data.id,
        rate: data.rate,
        audio: new Float32Array(data.rate * 60),
        length: 0,
        processed: 0,
        busy: false,
        final: false,
        decoder: new Decoder(session, metadata),
      };
    } else if (data.type === "stop" && (data.id === undefined || data.id === capture?.id)) {
      capture = null;
    } else if (capture && data.id === capture.id) {
      if (data.type === "samples" && !capture.final) {
        const samples = data.samples.subarray(
          0,
          capture.audio.length - capture.length,
        );
        capture.audio.set(samples, capture.length);
        capture.length += samples.length;
      }
      if (data.type === "finish" || capture.length === capture.audio.length)
        capture.final = true;
      pump(capture);
    }
  } catch (error) {
    postMessage({
      type: "error",
      id: data.id,
      message: error.message || String(error),
    });
  }
};
