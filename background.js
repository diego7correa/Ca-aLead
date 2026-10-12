const MAPS_HOST = /(^|\.)google\.com(\.br)?$/;

function isMapsTab(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && MAPS_HOST.test(u.hostname) && u.pathname.startsWith("/maps");
  } catch {
    return false;
  }
}

function isAllowedFetch(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && MAPS_HOST.test(u.hostname) && u.pathname.startsWith("/maps/");
  } catch {
    return false;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setTitle({
    title: "Extrator Maps — abra uma busca no Google Maps e clique aqui",
  });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;

  if (!isMapsTab(tab.url || "")) {
    chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#b45309" });
    chrome.action.setTitle({
      tabId: tab.id,
      title: "Abra uma busca no Google Maps (lista de estabelecimentos) e clique de novo.",
    });
    return;
  }

  chrome.action.setBadgeText({ tabId: tab.id, text: "" });
  chrome.action.setTitle({ tabId: tab.id, title: "Extrator Maps" });

  const ping = () => chrome.tabs.sendMessage(tab.id, { type: "TOGGLE" });

  try {
    await ping();
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/parser.js", "content/app.js"],
    });
    await ping();
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "BADGE") {
    const tabId = sender.tab?.id;
    if (!tabId) return false;
    chrome.action.setBadgeText({ tabId, text: msg.text ? String(msg.text) : "" });
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#0f766e" });
    return false;
  }

  if (msg?.type === "FETCH_TEXT") {
    if (!isAllowedFetch(msg.url)) {
      sendResponse({ ok: false, error: "URL fora do Google Maps." });
      return false;
    }
    fetch(msg.url, { credentials: "include", redirect: "follow" })
      .then(async (res) => {
        const text = await res.text();
        sendResponse({ ok: res.ok, status: res.status, text });
      })
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message ? err.message : err) }));
    return true;
  }

  return false;
});
