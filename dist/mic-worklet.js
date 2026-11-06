// Only send microphone samples during the active recognition window. Outputs stay silent.
class MorseMicrophone extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = null;
    this.buffer = new Float32Array(2048);
    this.offset = 0;
    this.port.onmessage = ({ data }) => {
      if (data.flush !== undefined) {
        if (this.active === data.flush) {
          if (this.offset) {
            const samples = this.buffer.slice(0, this.offset);
            this.port.postMessage({ id: this.active, samples }, [samples.buffer]);
          }
          this.port.postMessage({ flushed: this.active });
          this.active = null;
          this.offset = 0;
        }
        return;
      }
      this.active = data.active;
      this.offset = 0;
    };
  }
  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    const channel = inputs[0]?.[0];
    if (this.active !== null && channel) {
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.offset++] = channel[i];
        if (this.offset === this.buffer.length) {
          this.port.postMessage({ id: this.active, samples: this.buffer }, [
            this.buffer.buffer,
          ]);
          this.buffer = new Float32Array(2048);
          this.offset = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("morse-microphone", MorseMicrophone);
