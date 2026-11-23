/**
 * Sancord AudioWorkletProcessor — Executa a supressão adaptativa de ruído
 * na thread dedicada de áudio em tempo real (128 amostras / quantum),
 * sem bloquear a UI, sem alocações por frame e com fallback seguro para bypass
 * em caso de qualquer erro inesperado.
 */
/* global registerProcessor, AudioWorkletProcessor, sampleRate */

// O core DSP é injetado ou carregado no escopo do Worklet via importScripts/concatenação;
// no ambiente AudioWorkletGlobalScope (sem importScripts), embutimos uma referência leve
// ou carregamos os dois scripts em sequência via Blob/addModule.
class SancordNoiseSuppressorProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options?.processorOptions || {};
    const CoreCtor = globalThis.SancordVoiceDspCore?.SancordNoiseSuppressorCore;
    this.core = CoreCtor
      ? new CoreCtor({ sampleRate: typeof sampleRate === "number" ? sampleRate : 48000, mode: opts.mode || "auto" })
      : null;
    this.failed = !this.core;
    this.telemetryCounter = 0;
    this.monoScratch = new Float32Array(128);

    this.port.onmessage = (event) => {
      const msg = event?.data;
      if (!msg || typeof msg !== "object" || !this.core) return;
      try {
        if (msg.type === "setMode") this.core.setMode(msg.mode);
        else if (msg.type === "setAbBypassRaw") this.core.setAbBypassRaw(msg.value);
        else if (msg.type === "reset") this.core.reset();
      } catch (_) {}
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const outCh0 = output[0];
    if (!input || input.length === 0 || !input[0]) {
      for (let c = 0; c < output.length; c++) output[c].fill(0);
      return true;
    }

    const len = outCh0.length;
    // Downmix mono seguro se o dispositivo de entrada entregar estéreo (>1 canal)
    let monoIn = input[0];
    if (input.length > 1 && input[1]) {
      if (this.monoScratch.length !== len) this.monoScratch = new Float32Array(len);
      const ch0 = input[0];
      const ch1 = input[1];
      for (let i = 0; i < len; i++) this.monoScratch[i] = 0.5 * (ch0[i] + ch1[i]);
      monoIn = this.monoScratch;
    }

    if (this.failed || !this.core) {
      outCh0.set(monoIn);
    } else {
      try {
        this.core.processBlock(monoIn, outCh0);
      } catch (err) {
        // Fallback seguro: nunca derruba a thread de áudio nem a call!
        this.failed = true;
        outCh0.set(monoIn);
        try {
          this.port.postMessage({ type: "fallback", error: String(err?.message || err) });
        } catch (_) {}
      }
    }

    // Replica saída mono processada para canais adicionais de saída se houver
    for (let c = 1; c < output.length; c++) {
      output[c].set(outCh0);
    }

    // Telemetria leve (~10 Hz, nunca envia amostras de áudio!)
    this.telemetryCounter++;
    if (this.core && this.telemetryCounter >= 36) {
      this.telemetryCounter = 0;
      try {
        this.port.postMessage({ type: "diagnostics", data: this.core.getDiagnostics() });
      } catch (_) {}
    }
    return true;
  }
}

if (typeof registerProcessor === "function") {
  registerProcessor("sancord-noise-suppressor", SancordNoiseSuppressorProcessor);
}
