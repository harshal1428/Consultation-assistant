/**
 * PCM16 microphone worklet.
 *
 * Runs on the audio rendering thread so the main UI thread never touches raw
 * audio. Mono float samples are decimated/linearly held to 16 kHz, converted to
 * signed 16-bit PCM and posted in 20 ms chunks (320 samples).
 */
class PCM16Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    this.ratio = sampleRate / this.targetRate;
    this.position = 0;
    this.chunk = [];
    this.chunkSize = 320;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i += 1) {
      this.position += 1;
      if (this.position < this.ratio) continue;
      this.position -= this.ratio;

      const sample = Math.max(-1, Math.min(1, channel[i]));
      this.chunk.push(sample < 0 ? sample * 0x8000 : sample * 0x7fff);

      if (this.chunk.length >= this.chunkSize) {
        const pcm = new Int16Array(this.chunk);
        this.chunk = [];
        this.port.postMessage({ type: "pcm", buffer: pcm.buffer }, [pcm.buffer]);
      }
    }
    return true;
  }
}

registerProcessor("pcm16-processor", PCM16Processor);
