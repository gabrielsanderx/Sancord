// A captura de uma mensagem tem ciclo próprio e nunca altera as trilhas da call.
const voiceRecorderPanel = document.getElementById("composer-voice-recorder");
const voiceRecordLimit = 5 * 60 * 1000;
let voiceRecording = null;

function recordingButton(icon, title, action, primary = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = primary ? "btn-primary small-btn" : "btn-secondary small-btn";
  button.append(SancordIcons.node(icon), document.createTextNode(title));
  button.addEventListener("click", action);
  return button;
}

function releaseVoiceRecording(session) {
  clearInterval(session.timer);
  session.stream?.getTracks().forEach(track => track.stop());
  session.audioContext?.close().catch(() => {});
  session.audioContext = null;
  session.stream = null;
}

function cancelVoiceRecording(focus = true) {
  const session = voiceRecording;
  if (!session) return false;
  voiceRecording = null;
  if (session.recorder?.state === "recording") session.recorder.stop();
  releaseVoiceRecording(session);
  if (session.url) URL.revokeObjectURL(session.url);
  voiceRecorderPanel.replaceChildren();
  voiceRecorderPanel.classList.add("hidden");
  if (focus) chatInput.focus();
  return true;
}

function stopVoiceRecording(session) {
  if (voiceRecording !== session || session.recorder?.state !== "recording") return;
  session.recorder.stop();
  releaseVoiceRecording(session);
  voiceRecorderPanel.querySelector('[data-stop-recording]')?.setAttribute("disabled", "");
}

function showVoiceRecording(session) {
  const status = document.createElement("span");
  status.className = "voice-record-status";
  status.textContent = session.file ? "Gravação pronta" : session.recorder ? "Gravando" : "Solicitando microfone…";
  voiceRecorderPanel.replaceChildren(status);
  voiceRecorderPanel.classList.remove("hidden");
  if (session.file) {
    const preview = document.createElement("audio");
    preview.controls = true;
    preview.src = session.url;
    preview.setAttribute("aria-label", "Ouvir a gravação");
    voiceRecorderPanel.append(preview, recordingButton("close", "Cancelar", () => cancelVoiceRecording()),
      recordingButton("arrow", "Enviar", () => {
        if (getActiveTextChannelId() !== session.channelId || !composerContext().attach || currentSlowmodeWait(session.channelId) > 0) return;
        if (!addComposerFiles([session.file], "voice")) return;
        cancelVoiceRecording(false);
        chatForm.requestSubmit();
      }, true));
  } else if (session.recorder) {
    const time = document.createElement("output");
    time.className = "voice-record-time";
    time.textContent = "00:00";
    const wave = document.createElement("span");
    wave.className = "voice-record-wave";
    wave.setAttribute("aria-hidden", "true");
    const bars = Array.from({ length: 26 }, () => document.createElement("i"));
    wave.append(...bars);
    const stop = recordingButton("pause", "Parar", () => stopVoiceRecording(session), true);
    stop.dataset.stopRecording = "";
    voiceRecorderPanel.append(time, wave, recordingButton("close", "Cancelar", () => cancelVoiceRecording()), stop);
    const levels = bars.map(() => 2);
    const samples = session.analyser && new Float32Array(session.analyser.fftSize);
    session.timer = setInterval(() => {
      const elapsed = Date.now() - session.started;
      time.textContent = formatCallDuration(elapsed);
      if (samples) {
        session.analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        levels.shift();
        levels.push(Math.max(2, Math.min(24, Math.round(rms * 95))));
        bars.forEach((bar, index) => { bar.style.height = `${levels[index]}px`; });
      }
      if (elapsed >= voiceRecordLimit) stopVoiceRecording(session);
    }, 120);
  } else {
    voiceRecorderPanel.append(recordingButton("close", "Cancelar", () => cancelVoiceRecording()));
  }
  voiceRecorderPanel.querySelector("button")?.focus();
}

async function openVoiceRecorder() {
  const { channelId, attach, richMedia } = composerContext();
  if (!richMedia || !attach || voiceRecording) return;
  const session = { channelId };
  voiceRecording = session;
  showVoiceRecording(session);
  try {
    const mic = state.audioSettings.micDeviceId;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: mic ? { deviceId: { exact: mic } } : true });
    if (voiceRecording !== session || channelId !== getActiveTextChannelId() || !composerContext().attach) {
      stream.getTracks().forEach(track => track.stop());
      if (voiceRecording === session) cancelVoiceRecording();
      return;
    }
    session.stream = stream;
    const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find(type => MediaRecorder.isTypeSupported(type));
    session.recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 48000 } : undefined);
    const chunks = [];
    session.recorder.addEventListener("dataavailable", event => { if (event.data.size) chunks.push(event.data); });
    session.recorder.addEventListener("stop", () => {
      releaseVoiceRecording(session);
      if (voiceRecording !== session) return;
      const mime = session.recorder.mimeType || mimeType || "audio/webm";
      const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : "webm";
      const file = new File(chunks, `Mensagem de voz.${ext}`, { type: mime });
      if (!file.size || file.size > MAX_UPLOAD_BYTES) {
        cancelVoiceRecording();
        showErrorToast("A gravação está vazia ou passou do limite de envio.");
        return;
      }
      session.file = file;
      session.url = URL.createObjectURL(file);
      showVoiceRecording(session);
    });
    session.recorder.addEventListener("error", () => {
      if (voiceRecording !== session) return;
      cancelVoiceRecording();
      showErrorToast("A gravação foi interrompida. Tente de novo.");
    });
    try {
      session.audioContext = new AudioContext();
      session.analyser = session.audioContext.createAnalyser();
      session.analyser.fftSize = 256;
      session.audioContext.createMediaStreamSource(stream).connect(session.analyser);
      session.audioContext.resume().catch(() => {});
    } catch { /* A gravação continua disponível se a forma de onda falhar. */ }
    session.started = Date.now();
    session.recorder.start(250);
    showVoiceRecording(session);
  } catch (error) {
    if (voiceRecording !== session) return;
    cancelVoiceRecording();
    showErrorToast(error.name === "NotAllowedError" ? "Permita o acesso ao microfone no Windows para gravar." : "Não foi possível abrir o microfone selecionado.");
  }
}
