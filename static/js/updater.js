// O cliente Rust verifica e instala. O WebView apenas apresenta o estado e as ações.
(() => {
  const panel = document.createElement('section');
  panel.className = 'sancord-update-toast hidden';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Atualização do Sanvo');
  panel.innerHTML = `<strong id="sancord-update-title">Atualização disponível</strong>
    <p data-update-status role="status" aria-live="polite"></p>
    <pre class="sancord-update-notes" data-update-notes></pre>
    <progress class="sancord-update-progress hidden" data-update-progress max="100" value="0" aria-label="Progresso do download"></progress>
    <div class="sancord-update-actions"><button type="button" class="btn-primary" id="toast-update-action">Atualizar agora</button>
    <button type="button" class="btn-secondary" id="defer-update-btn">Depois</button></div>`;
  document.body.appendChild(panel);
  let phase = 'idle';
  let noticeKey = null;
  let dismissed = null;
  let manual = false;
  const post = action => window.ipc?.postMessage(`updates:${action}`);
  function updateAction() {
    if (phase === 'ready') post('restart');
    else if (phase === 'available') post('download');
  }
  document.getElementById('check-updates-btn')?.addEventListener('click', () => { manual = true; dismissed = null; post('check'); });
  document.getElementById('settings-update-action')?.addEventListener('click', updateAction);
  document.getElementById('toast-update-action').addEventListener('click', updateAction);
  document.getElementById('defer-update-btn').addEventListener('click', () => { dismissed = noticeKey; panel.classList.add('hidden'); });
  window.addEventListener('sancord-update', ({ detail: state }) => {
    phase = state.phase;
    noticeKey = `${phase}:${state.version || ''}`;
    const messages = {
      idle: 'Verifique se há uma nova versão disponível.', checking: 'Verificando atualizações…',
      available: `Sanvo v${state.version} está disponível.`, downloading: `Baixando atualização… ${state.percent || 0}%`,
      ready: 'Download verificado. Reinicie para instalar a atualização.', up_to_date: 'Você já está na versão mais recente.',
      error: state.message || 'Não foi possível verificar as atualizações.',
      not_configured: state.message || 'Atualizações automáticas ainda não disponíveis nesta versão.',
      updated: `Sanvo atualizado para v${state.version}.`,
    };
    const actionable = phase === 'available' || phase === 'ready';
    const title = { available:'Atualização disponível', downloading:'Baixando atualização', ready:'Pronto para instalar', updated:'Atualização concluída', error:'Não foi possível atualizar' };
    document.getElementById('sancord-update-title').textContent = title[phase] || 'Atualizações do Sanvo';
    document.querySelectorAll('[data-update-current]').forEach(el => { el.textContent = state.current || '…'; });
    document.querySelectorAll('[data-update-status]').forEach(el => { el.textContent = messages[phase] || ''; });
    if (state.notes !== undefined) document.querySelectorAll('[data-update-notes]').forEach(el => { el.textContent = state.notes; });
    if (['checking', 'up_to_date', 'not_configured'].includes(phase)) document.querySelectorAll('[data-update-notes]').forEach(el => { el.textContent = ''; });
    document.querySelectorAll('[data-update-progress]').forEach(el => {
      el.value = Math.min(100, Math.max(0, Number(state.percent) || 0));
      el.classList.toggle('hidden', phase !== 'downloading');
    });
    for (const id of ['settings-update-action', 'toast-update-action']) {
      const el = document.getElementById(id);
      if (el) { el.classList.toggle('hidden', !actionable); el.textContent = phase === 'ready' ? 'Reiniciar e instalar' : 'Atualizar agora'; }
    }
    const check = document.getElementById('check-updates-btn');
    if (check) check.disabled = phase === 'checking' || phase === 'downloading';
    if (actionable && dismissed !== noticeKey) panel.classList.remove('hidden');
    if (phase === 'updated') panel.classList.remove('hidden');
    if (phase === 'downloading') panel.classList.remove('hidden');
    if (phase === 'error' && manual) panel.classList.remove('hidden');
    if (phase === 'up_to_date' || phase === 'not_configured') panel.classList.add('hidden');
    if (!['checking', 'downloading'].includes(phase)) manual = false;
  });
  post('status');
})();
