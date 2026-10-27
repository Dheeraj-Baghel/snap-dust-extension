/* Enabling is explicit and origin-scoped; reloading avoids an already-open raw camera. */
(async () => {
  const button = document.getElementById('toggle');
  const status = document.getElementById('status');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab.url);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Open a browser meeting page first.');
    const key = `enabled:${url.origin}`;
    document.getElementById('site').textContent = url.origin;
    let enabled = (await chrome.storage.local.get(key))[key] === true;
    button.textContent = enabled ? 'Disable here & reload' : 'Enable here & reload'; button.disabled = false;
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await chrome.storage.local.set({ [key]: !enabled });
        await chrome.tabs.reload(tab.id);
        window.close();
      } catch (error) { status.textContent = error.message; button.disabled = false; }
    });
  } catch (error) { status.textContent = error.message; button.textContent = 'Unavailable on this page'; }
})();
