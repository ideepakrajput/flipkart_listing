// Service worker: opens the side panel and relays panel <-> content-script messages.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

const SELLER_RX = /^https:\/\/seller\.flipkart\.com\//;

function send(tabId, payload) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, payload, (res) => {
      const err = chrome.runtime.lastError;
      resolve(err ? { ok: false, error: err.message } : res);
    });
  });
}

// The content script is only auto-injected on pages loaded *after* the extension
// was installed. If the Seller Hub tab was already open, nothing is listening —
// so inject it on demand and retry.
async function ensureInjected(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/filler.js'] });
    return true;
  } catch (e) {
    return String(e.message || e);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'RELAY_TO_PAGE') return;
  (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return sendResponse({ ok: false, error: 'No active tab.' });
    if (!SELLER_RX.test(tab.url || '')) {
      return sendResponse({
        ok: false,
        error: 'Switch to the Flipkart Seller Hub tab, then try again.',
      });
    }
    let res = await send(tab.id, msg.payload);
    if (res.ok === false && /Receiving end does not exist|Could not establish connection/i.test(res.error || '')) {
      const injected = await ensureInjected(tab.id);
      if (injected !== true) {
        return sendResponse({ ok: false, error: `Could not inject into the page: ${injected}` });
      }
      res = await send(tab.id, msg.payload);
      if (res.ok === false) {
        res.error = `${res.error} — try reloading the Seller Hub tab.`;
      }
    }
    sendResponse(res);
  })();
  return true; // async
});
