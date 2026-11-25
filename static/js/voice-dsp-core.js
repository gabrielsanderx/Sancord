/**
 * SancordNoiseSuppressorCore — Motor DSP de supressão adaptativa de ruído em tempo real.
 *
 * Arquitetura compartilhada entre o AudioWorkletProcessor (thread dedicada de áudio)
 * e os testes automatizados / benchmarks em Node.js:
 *  - STFT 256 amostras com janela Hann periódica e 50% overlap-add (hop = 128 amostras
 *    = 2,67 ms a 48 kHz, alinhado 1:1 ao quantum do Web Audio sem buffer extra);
 *  - Zero alocações por frame na hot path (`processBlock`);
 *  - Estimador espectral adaptativo de piso de ruído (ventilador, AC, PC, chiado);
 *  - VAD suave multi-característica (SNR na banda de voz + tonalidade + consoantes)
 *    com ataque rápido (~6 ms) e hangover (~220 ms) para não cortar início/fim das palavras;
 *  - Supressor de transientes impulsivos (teclado mecânico, mouse, batidas) com recuo
 *    automático durante fala simultânea para preservar inteligibilidade;
 *  - Ganho Decision-Directed (estilo Ephraim-Malah) + suavização espectral/temporal +
 *    piso perceptual seguro para eliminar voz metálica / "underwater";
 *  - 5 modos (`auto`, `light`, `standard`, `strong`, `off`) com interpolação suave em tempo real;
 *  - Proteção contra NaN/Infinity, formatos inesperados, troca de sample rate e clipping de entrada.
 */
(function initSancordNoiseSuppressorCore(globalScope) {
  const VALID_MODES = Object.freeze(["auto", "light", "standard", "strong", "off"]);

  const MODE_PRESETS = Object.freeze({
    off:      { overSub: 0.0,  minGainSilence: 1.0,   minGainSpeech: 1.0,  transientAtten: 0.0,  speechBoost: 0.0,  silenceGateFloor: 1.0   },
    light:    { overSub: 1.65, minGainSilence: 0.14,  minGainSpeech: 0.84, transientAtten: 0.55, speechBoost: 0.25, silenceGateFloor: 0.18  },
    standard: { overSub: 2.55, minGainSilence: 0.045, minGainSpeech: 0.76, transientAtten: 0.82, speechBoost: 0.20, silenceGateFloor: 0.045 },
    strong:   { overSub: 3.45, minGainSilence: 0.018, minGainSpeech: 0.66, transientAtten: 0.92, speechBoost: 0.15, silenceGateFloor: 0.015 },
  });

  function sanitizeMode(raw, fallback = "auto") {
    const clean = String(raw || "").trim().toLowerCase();
    return VALID_MODES.includes(clean) ? clean : fallback;
  }

  /** Migra configurações antigas (`noiseGate: true/false` sem `noiseSuppressionMode`). */
  function migrateNoiseSuppressionSetting(audioSettings) {
    if (!audioSettings || typeof audioSettings !== "object") return "auto";
    if (typeof audioSettings.noiseSuppressionMode === "string") {
      return sanitizeMode(audioSettings.noiseSuppressionMode, "auto");
    }
    if (audioSettings.voiceProfile === "studio") return "off";
    if (audioSettings.noiseGate === false) return "off";
    return "auto";
  }

  class SancordNoiseSuppressorCore {
    constructor({ sampleRate = 48000, mode = "auto" } = {}) {
      this.fftSize = 256;
      this.hopSize = 128;
      this.bins = (this.fftSize >> 1) + 1; // 129 bins

      // Tabelas pré-alocadas para FFT radix-2 (ZERO alocações por frame).
      this._bitRev = new Uint16Array(this.fftSize);
      this._cos = new Float32Array(this.fftSize >> 1);
      this._sin = new Float32Array(this.fftSize >> 1);
      this._window = new Float32Array(this.fftSize);
      this._initFftTables();

      // Buffers pré-alocados de trabalho
      this._inFrame = new Float32Array(this.fftSize);
      this._outOverlap = new Float32Array(this.hopSize);
      this._fftRe = new Float32Array(this.fftSize);
      this._fftIm = new Float32Array(this.fftSize);
      this._power = new Float32Array(this.bins);
      this._prevPower = new Float32Array(this.bins);
      this._noisePsd = new Float32Array(this.bins);
      this._minPsd = new Float32Array(this.bins);
      this._gain = new Float32Array(this.bins);
      this._smoothGain = new Float32Array(this.bins);
      this._prevPostGain = new Float32Array(this.bins);
      this._scratchBlock = new Float32Array(this.hopSize);
      this._inQueue = new Float32Array(this.fftSize * 2);
      this._outQueue = new Float32Array(this.fftSize * 2);

      this.mode = sanitizeMode(mode, "auto");
      this.abBypassRaw = false; // Para comparação A/B no Teste do Microfone
      this.sampleRate = 48000;
      this.configureSampleRate(sampleRate);
      this.reset();
    }

    _initFftTables() {
      const N = this.fftSize;
      const bits = Math.log2(N) | 0;
      for (let i = 0; i < N; i++) {
        let rev = 0;
        let x = i;
        for (let b = 0; b < bits; b++) {
          rev = (rev << 1) | (x & 1);
          x >>= 1;
        }
        this._bitRev[i] = rev;
      }
      for (let k = 0; k < (N >> 1); k++) {
        const ang = (-2 * Math.PI * k) / N;
        this._cos[k] = Math.cos(ang);
        this._sin[k] = Math.sin(ang);
      }
      // Janela Hann periódica (soma de sobreposição 50% = exatamente 1.0, sem ripple).
      for (let i = 0; i < N; i++) {
        this._window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / N));
      }
    }

    configureSampleRate(sr) {
      const safeSr = Number.isFinite(sr) && sr >= 8000 && sr <= 192000 ? sr : 48000;
      this.sampleRate = safeSr;
      const binHz = safeSr / this.fftSize;
      const clampBin = (hz) => Math.max(1, Math.min(this.bins - 1, Math.round(hz / binHz)));
      this._rumbleMaxBin = clampBin(90);
      this._voiceMinBin = clampBin(110);
      this._voiceMaxBin = clampBin(3600);
      this._fricMinBin = clampBin(3400);
      this._fricMaxBin = clampBin(7800);
      this._clickMinBin = clampBin(1400);
      this._clickMaxBin = clampBin(7800);

      // Hangover de ~260 ms convertido em hops de 128 amostras (preserva finais de palavras)
      this._hangoverHops = Math.max(10, Math.round((0.26 * safeSr) / this.hopSize));
      // DC blocker + passa-alta suave (~85 Hz) por amostra
      const rc = 1 / (2 * Math.PI * 85);
      const dt = 1 / safeSr;
      this._dcAlpha = rc / (rc + dt);
    }

    reset() {
      this._inFrame.fill(0);
      this._outOverlap.fill(0);
      this._power.fill(0);
      this._prevPower.fill(0);
      this._noisePsd.fill(1e-7);
      this._minPsd.fill(1e-7);
      this._gain.fill(1.0);
      this._smoothGain.fill(1.0);
      this._prevPostGain.fill(1.0);
      this._inQueueLen = 0;
      this._outQueueLen = 0;

      // Estado do DC/HPF suave
      this._dcPrevIn = 0;
      this._dcPrevOut = 0;

      // Estado de VAD, hangover, auto-mode e suavização de crossfade
      this._frameCount = 0;
      this._vadProb = 0;
      this._hangoverLeft = 0;
      this._noiseFloorDb = -62;
      this._speechRmsDb = -70;
      this._autoIntensity = 0.5; // 0 = light, 0.5 = standard, 1 = strong
      this._wetMix = this.mode === "off" ? 0 : 1;
      this._effOverSub = 2.15;
      this._effMinSilence = 0.06;
      this._effMinSpeech = 0.76;
      this._effTransient = 0.78;
      this._effSilenceGateFloor = 0.06;
      this._silenceEnv = 1.0;
      this._prevHighEnergy = 1e-7;
      this._transientHold = 0;
      this._limiterGain = 1.0;

      // Diagnóstico local (sem logar amostras de áudio)
      this._clippingFrames = 0;
      this._isClipping = false;
      this._overruns = 0;
      this._lastProcessMs = 0;
      this._avgProcessMs = 0;
      this._droppedFrames = 0;
    }

    setMode(mode) {
      this.mode = sanitizeMode(mode, this.mode);
    }

    setAbBypassRaw(raw) {
      this.abBypassRaw = Boolean(raw);
    }

    /** FFT/IFFT radix-2 in-place sobre `_fftRe` / `_fftIm` (0 alocações). */
    _fft(inverse) {
      const N = this.fftSize;
      const re = this._fftRe;
      const im = this._fftIm;
      const bitRev = this._bitRev;
      for (let i = 0; i < N; i++) {
        const j = bitRev[i];
        if (i < j) {
          let tr = re[i]; re[i] = re[j]; re[j] = tr;
          let ti = im[i]; im[i] = im[j]; im[j] = ti;
        }
      }
      const cos = this._cos;
      const sin = this._sin;
      const sign = inverse ? -1 : 1;
      for (let len = 2; len <= N; len <<= 1) {
        const half = len >> 1;
        const step = N / len;
        for (let i = 0; i < N; i += len) {
          let idx = 0;
          for (let j = 0; j < half; j++) {
            const wr = cos[idx];
            const wi = sign * sin[idx];
            idx += step;
            const uRe = re[i + j];
            const uIm = im[i + j];
            const k = i + j + half;
            const vRe = re[k] * wr - im[k] * wi;
            const vIm = re[k] * wi + im[k] * wr;
            re[i + j] = uRe + vRe;
            im[i + j] = uIm + vIm;
            re[k] = uRe - vRe;
            im[k] = uIm - vIm;
          }
        }
      }
      if (inverse) {
        const invN = 1 / N;
        for (let i = 0; i < N; i++) {
          re[i] *= invN;
          im[i] *= invN;
        }
      }
    }

    _resolveTargetParams() {
      if (this.mode === "off" || this.abBypassRaw) {
        return MODE_PRESETS.off;
      }
      if (this.mode !== "auto") {
        return MODE_PRESETS[this.mode] || MODE_PRESETS.standard;
      }
      // Modo Automático: adapta suavemente ao piso de ruído estimado.
      // Começa já com boa limpeza mesmo em ambientes médios (-64..-44 dB) e
      // escala até o modo Forte em ambientes com ventilador / AC / ruído alto.
      const targetIntensity = Math.max(0.25, Math.min(1, (this._noiseFloorDb + 64) / 18));
      this._autoIntensity += (targetIntensity - this._autoIntensity) * 0.025;
      const t = this._autoIntensity;
      if (t <= 0.5) {
        const u = t * 2;
        const a = MODE_PRESETS.light;
        const b = MODE_PRESETS.standard;
        return {
          overSub: a.overSub + (b.overSub - a.overSub) * u,
          minGainSilence: a.minGainSilence + (b.minGainSilence - a.minGainSilence) * u,
          minGainSpeech: a.minGainSpeech + (b.minGainSpeech - a.minGainSpeech) * u,
          transientAtten: a.transientAtten + (b.transientAtten - a.transientAtten) * u,
          silenceGateFloor: a.silenceGateFloor + (b.silenceGateFloor - a.silenceGateFloor) * u,
        };
      }
      const u = (t - 0.5) * 2;
      const a = MODE_PRESETS.standard;
      const b = MODE_PRESETS.strong;
      return {
        overSub: a.overSub + (b.overSub - a.overSub) * u,
        minGainSilence: a.minGainSilence + (b.minGainSilence - a.minGainSilence) * u,
        minGainSpeech: a.minGainSpeech + (b.minGainSpeech - a.minGainSpeech) * u,
        transientAtten: a.transientAtten + (b.transientAtten - a.transientAtten) * u,
        silenceGateFloor: a.silenceGateFloor + (b.silenceGateFloor - a.silenceGateFloor) * u,
      };
    }

    /** Processa um hop de exatamente 128 amostras (`_inFrame` atualizado). */
    _processHop(inHop, outHop) {
      const N = this.fftSize;
      const H = this.hopSize;
      const frame = this._inFrame;

      // Desloca metade anterior e preenche com novo hop (com proteção contra NaN + detecção de clipping)
      for (let i = 0; i < H; i++) frame[i] = frame[i + H];
      let peakIn = 0;
      let sumSqIn = 0;
      let dcPrevIn = this._dcPrevIn;
      let dcPrevOut = this._dcPrevOut;
      const dcAlpha = this._dcAlpha;

      for (let i = 0; i < H; i++) {
        let s = inHop[i];
        if (!Number.isFinite(s)) s = 0;
        const absS = s < 0 ? -s : s;
        if (absS > peakIn) peakIn = absS;
        sumSqIn += s * s;
        // DC blocker / passa-alta suave (~68 Hz)
        const hp = dcAlpha * (dcPrevOut + s - dcPrevIn);
        dcPrevIn = s;
        dcPrevOut = hp;
        frame[H + i] = hp;
      }
      this._dcPrevIn = dcPrevIn;
      this._dcPrevOut = dcPrevOut;

      // Detecta clipping de entrada no microfone (>= 0.985)
      if (peakIn >= 0.985) {
        this._clippingFrames = Math.min(200, this._clippingFrames + 1);
        this._isClipping = true;
      } else if (this._clippingFrames > 0) {
        this._clippingFrames--;
        if (this._clippingFrames === 0) this._isClipping = false;
      }

      const rmsIn = Math.sqrt(sumSqIn / H + 1e-12);
      const crestFactor = peakIn / (rmsIn + 1e-6);

      // Aplica janela Hann e executa FFT
      const win = this._window;
      const re = this._fftRe;
      const im = this._fftIm;
      for (let i = 0; i < N; i++) {
        re[i] = frame[i] * win[i];
        im[i] = 0;
      }
      this._fft(false);

      const bins = this.bins;
      const power = this._power;
      const noisePsd = this._noisePsd;
      const minPsd = this._minPsd;

      let voicePower = 0;
      let voiceNoise = 0;
      let highPower = 0;
      let totalNoise = 0;
      let logSum = 0;
      let linSum = 0;
      let voiceBins = 0;

      this._frameCount++;
      const warmupWeight = this._frameCount <= 12 ? (1 / this._frameCount) : 0;

      for (let k = 0; k < bins; k++) {
        const p = re[k] * re[k] + im[k] * im[k] + 1e-12;
        power[k] = p;
        // 1. Warm-up inicial (primeiros 12 hops ≈ 32 ms) inicializa o noise floor antes do cálculo de SNR
        if (warmupWeight > 0) {
          noisePsd[k] = this._frameCount === 1 ? p : (noisePsd[k] * (1 - warmupWeight) + p * warmupWeight);
          minPsd[k] = noisePsd[k];
        }
        if (k >= this._voiceMinBin && k <= this._voiceMaxBin) {
          voicePower += p;
          voiceNoise += noisePsd[k];
          logSum += Math.log(p);
          linSum += p;
          voiceBins++;
        }
        if (k >= this._clickMinBin && k <= this._clickMaxBin) {
          highPower += p;
        }
        totalNoise += noisePsd[k];
      }

      // 2. VAD suave multi-característica (SNR de voz + tonalidade harmônica)
      const voiceSnr = voicePower / (voiceNoise + 1e-10);
      const geoMean = voiceBins > 0 ? Math.exp(logSum / voiceBins) : 1e-12;
      const ariMean = voiceBins > 0 ? linSum / voiceBins : 1e-12;
      // Spectral flatness: 0 = tonal (voz), 1 = ruído branco/ventilador/teclado
      const flatness = Math.max(0, Math.min(1, geoMean / (ariMean + 1e-12)));
      const tonality = 1 - flatness;

      // Impulso curto de teclado/mouse: alto crest factor + salto abrupto em alta frequência + baixa tonalidade
      const highFlux = highPower / (this._prevHighEnergy + 1e-10);
      const isImpulse =
        crestFactor > 4.2 &&
        highFlux > 2.8 &&
        tonality < 0.62 &&
        voiceSnr < 8.5;
      this._prevHighEnergy = this._prevHighEnergy * 0.78 + highPower * 0.22;
      if (isImpulse) {
        this._transientHold = 4; // ~10.6 ms
      } else if (this._transientHold > 0) {
        this._transientHold--;
      }

      // Probabilidade bruta de fala (favorece início de fala e voz baixa, mas exige energia acima do piso estacionário)
      const snrDb = 10 * Math.log10(voiceSnr + 1e-6);
      let rawVad = 0;
      if (!isImpulse && this._frameCount > 6 && snrDb > 2.0) {
        const snrScore = Math.max(0, Math.min(1, (snrDb - 2.5) / 8.5));
        const tonalBonus = (snrScore > 0.05 && tonality > 0.48)
          ? 0.22 * Math.min(1, (tonality - 0.48) / 0.35)
          : 0;
        rawVad = Math.max(0, Math.min(1, snrScore + tonalBonus));
      }

      // Ataque muito rápido (~6 ms) + hangover (~220 ms) + release suave
      if (rawVad >= 0.42) {
        this._hangoverLeft = this._hangoverHops;
        this._vadProb = this._vadProb * 0.35 + rawVad * 0.65;
      } else if (this._hangoverLeft > 0) {
        this._hangoverLeft--;
        // Mantém estado de fala suave durante hangover para preservar finais de palavras ("s", "f", "ch")
        const floorVad = Math.max(rawVad, 0.55 * (this._hangoverLeft / this._hangoverHops));
        this._vadProb = this._vadProb * 0.86 + floorVad * 0.14;
      } else {
        this._vadProb = this._vadProb * 0.88 + rawVad * 0.12;
      }

      // 3. Atualização adaptativa do PSD de ruído:
      //    - Em silêncio/ruído (sem fala e sem impulso): média simétrica (não enviesada!)
      //      para estimar o verdadeiro PSD médio do ventilador/AC/chiado.
      //    - Durante fala: trava subida para nunca aprender voz como ruído.
      const speechWeight = this._vadProb;
      const inNoiseOnly = !isImpulse && speechWeight < 0.25;
      const upRate = isImpulse ? 0.0 : (inNoiseOnly ? 0.08 : 0.0015 * (1 - speechWeight));
      const downRate = inNoiseOnly ? 0.08 : 0.05;
      for (let k = 0; k < bins; k++) {
        const p = power[k];
        if (p < noisePsd[k]) {
          noisePsd[k] += (p - noisePsd[k]) * downRate;
        } else if (upRate > 0) {
          noisePsd[k] += (p - noisePsd[k]) * upRate;
        }
        // Rastreamento lento de mínimo para se adaptar se o ventilador desligar
        minPsd[k] = p < minPsd[k] ? p : minPsd[k] * 1.0005 + p * 0.0005;
        if (noisePsd[k] > minPsd[k] * 10.0 && inNoiseOnly) {
          noisePsd[k] = noisePsd[k] * 0.97 + minPsd[k] * 0.03;
        }
      }

      const estNoiseRms = Math.sqrt(totalNoise / (N * N) + 1e-12);
      const estNoiseDb = Math.max(-85, Math.min(0, 20 * Math.log10(estNoiseRms + 1e-7)));
      this._noiseFloorDb = this._noiseFloorDb * 0.94 + estNoiseDb * 0.06;
      this._speechRmsDb = Math.max(-85, Math.min(0, 20 * Math.log10(rmsIn + 1e-7)));

      // 4. Interpolação suave dos parâmetros de modo (zero click/pop ao trocar modo ao vivo!)
      const target = this._resolveTargetParams();
      const targetWet = (this.mode === "off" || this.abBypassRaw) ? 0.0 : 1.0;
      this._wetMix += (targetWet - this._wetMix) * 0.22;
      this._effOverSub += (target.overSub - this._effOverSub) * 0.12;
      this._effMinSilence += (target.minGainSilence - this._effMinSilence) * 0.12;
      this._effMinSpeech += (target.minGainSpeech - this._effMinSpeech) * 0.12;
      this._effTransient += (target.transientAtten - this._effTransient) * 0.12;
      const targetGateFloor = typeof target.silenceGateFloor === "number" ? target.silenceGateFloor : 1.0;
      this._effSilenceGateFloor += (targetGateFloor - this._effSilenceGateFloor) * 0.12;

      // Envelope suave de silêncio (estilo Discord/Krisp): abre em <4 ms ao detectar voz
      // e atenua suavemente o ruído residual nos intervalos sem fala (sem corte seco).
      const envTarget = this._vadProb >= 0.25 ? 1.0 : this._effSilenceGateFloor;
      const envCoef = envTarget > this._silenceEnv ? 0.68 : 0.09;
      this._silenceEnv += (envTarget - this._silenceEnv) * envCoef;
      const wetSilenceEnv = 1 + (this._silenceEnv - 1) * this._wetMix;

      // 5. Ganho Decision-Directed Wiener (anti-underwater!) + preservação de voz + transientes
      const gain = this._gain;
      const smoothGain = this._smoothGain;
      const prevPower = this._prevPower;
      const prevPostGain = this._prevPostGain;
      const speechMix = this._vadProb;
      const ddAlpha = 0.90 + 0.06 * speechMix; // alta persistência na fala elimina ruído musical / metálico!

      // Piso dinâmico: sobe bastante durante fala para manter voz natural e rica
      const minFloorBase =
        this._effMinSilence + (this._effMinSpeech - this._effMinSilence) * speechMix;

      // Durante fala ativa, reduz a agressividade de subtração em 40%
      const activeOverSub = this._effOverSub * (1 - 0.40 * speechMix);

      for (let k = 0; k < bins; k++) {
        const np = noisePsd[k] * Math.max(0.25, activeOverSub) + 1e-12;
        const smoothedP = 0.45 * prevPower[k] + 0.55 * power[k];
        const postSnr = smoothedP / np;
        const prevSnr = (prevPower[k] * prevPostGain[k] * prevPostGain[k]) / np;
        const aprioriSnr = ddAlpha * prevSnr + (1 - ddAlpha) * Math.max(postSnr - 1.35, 0);
        let g = aprioriSnr / (aprioriSnr + 1);
        if (speechMix < 0.55) {
          const p = 1 + (1 - speechMix / 0.55) * 0.95;
          g = Math.pow(g, p);
        }

        // Atenuação extra abaixo de 90 Hz (rumble de mesa / hum de 60 Hz / ventilador)
        if (k <= this._rumbleMaxBin) {
          g *= 0.32;
        }
        // Proteção extra para fricativas/consoantes durante fala ou hangover ("s", "f", "ch")
        let binFloor = minFloorBase;
        if (this._vadProb > 0.25 && k >= this._fricMinBin && k <= this._fricMaxBin) {
          binFloor = Math.max(binFloor, 0.46 * this._vadProb + this._effMinSilence);
        }

        // Supressão impulsiva de teclado/mouse:
        // - Sem fala: atenua fortemente o clique
        // - Com fala simultânea: recua para manter a voz perfeitamente inteligível!
        if (this._transientHold > 0 && k >= this._clickMinBin) {
          const speechBackoff = 1 - 0.72 * this._vadProb;
          const tAtten = 1 - this._effTransient * speechBackoff;
          g *= Math.max(0.10, tAtten);
        }

        if (g < binFloor) g = binFloor;
        if (g > 1.0) g = 1.0;
        gain[k] = g;
      }

      // 6. Suavização espectral entre bins vizinhos (evita artefato metálico / "bolhas")
      for (let k = 0; k < bins; k++) {
        const gPrev = k > 0 ? gain[k - 1] : gain[k];
        const gCurr = gain[k];
        const gNext = k < bins - 1 ? gain[k + 1] : gain[k];
        const freqSmoothed = 0.20 * gPrev + 0.60 * gCurr + 0.20 * gNext;
        // Attack rápido ao abrir para voz, release suave ao fechar
        const timeCoef = freqSmoothed > smoothGain[k] ? 0.55 : 0.22;
        smoothGain[k] += (freqSmoothed - smoothGain[k]) * timeCoef;

        const applied = (1 + (smoothGain[k] - 1) * this._wetMix) * wetSilenceEnv;
        re[k] *= applied;
        im[k] *= applied;
        if (k > 0 && k < bins - 1) {
          re[N - k] = re[k];
          im[N - k] = -im[k];
        }
        prevPower[k] = power[k];
        prevPostGain[k] = applied;
      }

      // 7. IFFT + Overlap-Add + Safety Limiter transparente (-1.5 dBFS ceiling = 0.84)
      this._fft(true);
      const overlap = this._outOverlap;
      let limGain = this._limiterGain;
      for (let i = 0; i < H; i++) {
        let sample = re[i] + overlap[i];
        overlap[i] = re[i + H];
        // Limiter suave para evitar clipping em fala alta sem esmagar dinâmica
        const abs = sample < 0 ? -sample : sample;
        const targetLim = abs > 0.86 ? 0.86 / abs : 1.0;
        limGain += (targetLim - limGain) * (targetLim < limGain ? 0.45 : 0.04);
        sample *= limGain;
        if (sample > 0.96) sample = 0.96;
        else if (sample < -0.96) sample = -0.96;
        outHop[i] = Number.isFinite(sample) ? sample : 0;
      }
      this._limiterGain = limGain;
    }

    /**
     * Processa um bloco de entrada (tipicamente 128 amostras no AudioWorklet, mas aceita
     * qualquer tamanho arbitrário com segurança, incluindo bypass verdadeiro no modo `off`).
     */
    processBlock(input, output) {
      if (!output || typeof output.length !== "number") return;
      const len = output.length;
      if (!input || typeof input.length !== "number" || input.length === 0) {
        output.fill(0);
        return;
      }

      // Bypass verdadeiro quando modo é OFF e crossfade já zerou (zero custo de FFT!)
      if ((this.mode === "off" || this.abBypassRaw) && this._wetMix <= 0.002) {
        const copyLen = Math.min(len, input.length);
        let peak = 0;
        for (let i = 0; i < copyLen; i++) {
          const s = Number.isFinite(input[i]) ? input[i] : 0;
          output[i] = s;
          const a = s < 0 ? -s : s;
          if (a > peak) peak = a;
        }
        if (copyLen < len) output.fill(0, copyLen);
        this._isClipping = peak >= 0.985;
        this._lastProcessMs = 0;
        return;
      }

      const t0 = typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : 0;

      // Caminho rápido 1:1 para o quantum nativo de 128 amostras do Web Audio (zero fila extra!)
      if (len === this.hopSize && input.length === this.hopSize && this._inQueueLen === 0 && this._outQueueLen === 0) {
        this._processHop(input, output);
      } else {
        // Caminho genérico seguro para qualquer tamanho de buffer inesperado
        const inQ = this._inQueue;
        const outQ = this._outQueue;
        const cap = inQ.length;
        const H = this.hopSize;
        let inPos = 0;
        let outPos = 0;

        while (inPos < input.length || outPos < len) {
          if (inPos < input.length && this._inQueueLen < cap) {
            const take = Math.min(input.length - inPos, cap - this._inQueueLen);
            for (let i = 0; i < take; i++) inQ[this._inQueueLen + i] = input[inPos + i];
            this._inQueueLen += take;
            inPos += take;
          }
          while (this._inQueueLen >= H && this._outQueueLen + H <= cap) {
            this._processHop(inQ.subarray(0, H), this._scratchBlock);
            // Compacta inQ sem alocar
            const rem = this._inQueueLen - H;
            for (let i = 0; i < rem; i++) inQ[i] = inQ[i + H];
            this._inQueueLen = rem;
            for (let i = 0; i < H; i++) outQ[this._outQueueLen + i] = this._scratchBlock[i];
            this._outQueueLen += H;
          }
          if (outPos < len && this._outQueueLen > 0) {
            const emit = Math.min(len - outPos, this._outQueueLen);
            for (let i = 0; i < emit; i++) output[outPos + i] = outQ[i];
            const remOut = this._outQueueLen - emit;
            for (let i = 0; i < remOut; i++) outQ[i] = outQ[i + emit];
            this._outQueueLen = remOut;
            outPos += emit;
          } else {
            break;
          }
        }
        if (outPos < len) output.fill(0, outPos);
      }

      if (t0 > 0) {
        const dt = performance.now() - t0;
        this._lastProcessMs = dt;
        this._avgProcessMs = this._avgProcessMs === 0 ? dt : this._avgProcessMs * 0.92 + dt * 0.08;
        const budgetMs = (len / this.sampleRate) * 1000;
        if (dt > budgetMs * 0.85) this._overruns++;
      }
    }

    getDiagnostics() {
      return {
        sampleRate: this.sampleRate,
        frameSize: this.fftSize,
        hopSize: this.hopSize,
        latencyMs: Number(((this.hopSize / this.sampleRate) * 1000).toFixed(2)),
        mode: this.mode,
        abBypassRaw: this.abBypassRaw,
        effectiveIntensity: this.mode === "auto" ? Number(this._autoIntensity.toFixed(2)) : null,
        noiseFloorDb: Number(this._noiseFloorDb.toFixed(1)),
        speechRmsDb: Number(this._speechRmsDb.toFixed(1)),
        vadProb: Number(this._vadProb.toFixed(2)),
        voiceDetected: this._vadProb >= 0.38,
        suppressionActive: this.mode !== "off" && !this.abBypassRaw,
        clipping: this._isClipping,
        processMs: Number(this._avgProcessMs.toFixed(3)),
        lastProcessMs: Number(this._lastProcessMs.toFixed(3)),
        overruns: this._overruns,
        droppedFrames: this._droppedFrames,
      };
    }
  }

  const exported = {
    SancordNoiseSuppressorCore,
    SanvoNoiseSuppressorCore: SancordNoiseSuppressorCore,
    VALID_MODES,
    MODE_PRESETS,
    sanitizeMode,
    migrateNoiseSuppressionSetting,
  };

  if (globalScope) {
    globalScope.SanvoVoiceDspCore = exported;
    globalScope.SancordVoiceDspCore = exported; // LEGACY COMPATIBILITY
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exported;
  }
})(typeof globalThis !== "undefined" ? globalThis : self);
