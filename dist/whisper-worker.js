"use strict";
// Loaded only when the experimental engine is selected and voice is started.
let transcriber;
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      if (data.type === "load") {
        const { pipeline, env } = await import(
          "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js"
        );
        env.allowLocalModels = false;
        // GitHub Pages cannot supply cross-origin isolation headers. One WASM
        // thread also avoids oversubscribing mobile CPUs while Morse plays.
        env.backends.onnx.wasm.numThreads = 1;
        transcriber = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en", {
          revision: "79fb389fc764e7c395bd330e9531d9d32ada7049",
          device: "wasm",
          dtype: "q8",
          progress_callback: (progress) => {
            if (progress.status === "progress")
              self.postMessage({ type: "progress", file: progress.file, percent: Math.floor(progress.progress) });
          },
        });
        self.postMessage({ id: data.id, type: "ready" });
      } else if (data.type === "transcribe") {
        if (!transcriber) throw new Error("Whisper is not loaded.");
        // Input is mono 16 kHz PCM. No call sign or expected answer is supplied.
        const result = await transcriber(data.samples, { max_new_tokens: 128 });
        self.postMessage({ id: data.id, text: result.text.trim() });
      }
    } catch (error) {
      self.postMessage({ id: data.id, error: error.message || String(error) });
    }
  });
};
