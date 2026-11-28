// AudioWorklet for dictation capture, loaded by URL (`dictation.ts`): the bridge page's CSP allows
// `script-src 'self'` and no blob:, while through the relay it arrives as a blob: (`bridgeScriptUrl`).

class RoveCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buf = new Float32Array(4096)
    this.n = 0
  }

  process(inputs) {
    const channel = inputs[0]?.[0]
    if (channel) {
      if (this.n + channel.length > this.buf.length) {
        const grown = new Float32Array(this.buf.length * 2)
        grown.set(this.buf)
        this.buf = grown
      }
      this.buf.set(channel, this.n)
      this.n += channel.length
      // One message per 2048 frames: chatty enough for a level meter, quiet enough to stay cheap.
      if (this.n >= 2048) {
        this.port.postMessage(this.buf.slice(0, this.n))
        this.n = 0
      }
    }
    return true
  }
}

registerProcessor("rove-capture", RoveCapture)
