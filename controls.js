/* Isolated-world UI; enabled per origin, never requests camera access itself. */
(() => {
  const key = `enabled:${location.origin}`;
  let host, status, listenButton;
  const send = (command, extra = {}) => window.postMessage({ channel: 'snap-dust-command', command, ...extra }, location.origin);
  chrome.storage.local.get(key).then(values => {
    const enabled = values[key] === true;
    send('configure', { enabled });
    if (!enabled) return;
    window.addEventListener('message', event => {
      if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'snap-dust-status') return;
      if (event.data.active === true && !host) mount();
      if (status) status.textContent = event.data.text;
      if (listenButton && typeof event.data.listening === 'boolean') {
        listenButton.textContent = event.data.listening ? 'Stop listening' : 'Listen for snaps';
        listenButton.setAttribute('aria-pressed', String(event.data.listening));
      }
      if (event.data.active === false) { host?.remove(); host = null; }
    });
    window.addEventListener('keydown', event => {
      if (event.altKey && event.shiftKey && event.code === 'KeyD' && !event.repeat && host) { event.preventDefault(); send('snap'); }
    });
  }).catch(() => send('configure', { enabled: false }));
  function mount() {
    host = document.createElement('div'); host.id = 'snap-dust-controls';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      :host{all:initial;position:fixed;bottom:20px;right:20px;z-index:2147483647;font-family:system-ui,sans-serif;color:#f4f4f7;font-size:13px}
      section{width:290px;max-width:calc(100vw - 56px);background:#18191e;border:1px solid #555963;border-radius:14px;padding:16px;box-sizing:border-box}
      h2{font-size:16px;margin:0 0 8px}p{line-height:1.5;margin:8px 0}button{font:inherit;border:1px solid #656875;background:#30333c;color:white;border-radius:8px;padding:10px;min-height:44px;cursor:pointer}button:focus-visible{outline:3px solid #b5ccff;outline-offset:2px}.row{display:flex;gap:8px;flex-wrap:wrap}button.primary{background:#4268d8;border-color:#7897ed}.hint{font-size:11px;color:#bbc1cf}summary{cursor:pointer;min-height:24px}
    </style><section aria-label="Snap Dust camera controls"><h2>Snap Dust</h2><p role="status" aria-live="polite">Camera ready</p><div class="row"><button class="primary" data-command="snap">Disappear</button><button data-command="return">Reappear</button></div><details open><summary>Setup & snap detection</summary><p>Step out of view, keep the camera still, then save the empty room.</p><div class="row"><button data-command="plate">Save empty room</button><button data-command="listen" aria-pressed="false">Listen for snaps</button></div><p class="hint">Listening requests separate microphone access. Audio stays here; clicks/claps can also trigger. Alt + Shift + D disappears.</p></details></section>`;
    status = shadow.querySelector('[role="status"]'); listenButton = shadow.querySelector('[data-command="listen"]');
    shadow.querySelectorAll('button').forEach(button => button.addEventListener('click', () => send(button.dataset.command)));
    (document.body || document.documentElement).appendChild(host);
  }
})();
