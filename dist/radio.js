"use strict";

// A receiver bed and a separate fading path for the wanted CW signal.
class RadioEnvironment {
  constructor(ctx, start, duration, { staticLevel, interference, fading, volume, hz }) {
    this.sources = new Set();
    this.connections = [];
    // Zero means bypass: allocate no audio nodes or sample buffers.
    if (!(staticLevel > 0 || interference > 0 || fading > 0)) return;
    const keep = (node) => {
      this.connections.push(node);
      return node;
    };
    const output = keep(ctx.createGain());
    output.connect(ctx.destination);
    const end = start + duration + 0.12;
    output.gain.setValueAtTime(0, start - 0.05);
    output.gain.linearRampToValueAtTime(volume, start);
    output.gain.setValueAtTime(volume, end - 0.05);
    output.gain.linearRampToValueAtTime(0, end);
    this.input = output;
    if (fading > 0) {
      this.input = keep(ctx.createGain());
      this.input.connect(output);

      // Slow, continuous QSB with a different received strength on each replay.
      const depth = fading / 100;
      const strength = 1 - depth * (0.15 + Math.random() * 0.45);
      const phase = Math.random() * Math.PI * 2;
      const period = 2.5 + Math.random() * 4;
      const curve = new Float32Array(Math.max(2, Math.ceil((end - start) * 30)));
      for (let i = 0; i < curve.length; i++) {
        const t = (i / (curve.length - 1)) * (end - start);
        const swell = (1 + Math.sin(phase + (t * 2 * Math.PI) / period)) / 2;
        const flutter = (1 + Math.sin(phase * 2 + t * 11)) / 2;
        curve[i] = strength * (1 - depth * (0.75 * swell + 0.1 * flutter));
      }
      this.input.gain.setValueCurveAtTime(curve, start, end - start);
    }

    const source = (node, at = start - 0.05, until = end) => {
      this.sources.add(node);
      node.onended = () => {
        node.disconnect();
        this.sources.delete(node);
        if (!this.sources.size) this.disconnect();
      };
      node.start(at);
      node.stop(until);
    };
    const noise = (seconds, crackle = false) => {
      const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let burst = 0;
      for (let i = 0; i < data.length; i++) {
        if (crackle && Math.random() < 12 / ctx.sampleRate) burst = 0.3 + Math.random() * 0.7;
        burst *= Math.exp(-1 / (ctx.sampleRate * 0.006));
        data[i] = (Math.random() * 2 - 1) * (crackle ? burst : 1);
      }
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.loop = true;
      return node;
    };
    const filteredNoise = (level, crackle) => {
      const filter = keep(ctx.createBiquadFilter());
      filter.type = "bandpass";
      filter.frequency.value = hz;
      filter.Q.value = 0.65;
      const gain = keep(ctx.createGain());
      gain.gain.value = level;
      const node = noise(3.7, crackle);
      node.connect(filter);
      filter.connect(gain);
      gain.connect(output);
      source(node);
    };
    if (staticLevel > 0) {
      filteredNoise(0.35 * staticLevel / 100, false);
      filteredNoise(0.65 * staticLevel / 100, true);
    }
    if (interference > 0) {
      // A wandering carrier and an intermittent nearby CW station (QRM).
      const level = interference / 100;
      for (const nearby of [false, true]) {
        const osc = ctx.createOscillator();
        const gain = keep(ctx.createGain());
        const frequency = Math.max(150, hz + (nearby ? 170 : -230));
        osc.frequency.setValueAtTime(frequency, start);
        osc.frequency.linearRampToValueAtTime(frequency + Math.random() * 24 - 12, end);
        gain.gain.setValueAtTime(0, start - 0.05);
        if (nearby) {
          for (let t = start + 0.1; t < end - 0.2;) {
            const length = Math.min(Math.random() < 0.5 ? 0.075 : 0.225, end - t - 0.01);
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.055 * level, t + 0.005);
            gain.gain.setValueAtTime(0.055 * level, t + length - 0.005);
            gain.gain.linearRampToValueAtTime(0, t + length);
            t += length + (Math.random() < 0.25 ? 0.45 : 0.075);
          }
        } else {
          gain.gain.linearRampToValueAtTime(0.025 * level, start);
        }
        osc.connect(gain);
        gain.connect(output);
        source(osc);
      }
    }

  }

  disconnect() {
    for (const node of this.connections) node.disconnect();
    this.connections.length = 0;
  }

  stop() {
    for (const node of this.sources) {
      try { node.stop(); } catch {}
      node.disconnect();
    }
    this.sources.clear();
    this.disconnect();
  }
}
