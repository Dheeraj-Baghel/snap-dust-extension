// Installation metadata only. No camera/audio handling, network or automatic tabs.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.storage.local.set({ installedVersion: chrome.runtime.getManifest().version });
});
