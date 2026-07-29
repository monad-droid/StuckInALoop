// Runs in the extension's isolated world at document_start on autoplay-blocked
// sites. Mirrors the per-site toggle from chrome.storage into a DOM attribute
// that the MAIN-world blocker (autoplay-blocker.js) reads synchronously —
// MAIN-world scripts have no access to chrome.storage.
(() => {
  const AUTOPLAY_BLOCK_SITES = {
    "instagram.com": "pauseInstagramReels",
    "x.com": "pauseXVideos",
    "twitter.com": "pauseXVideos",
    "facebook.com": "pauseFacebookVideos",
    "tiktok.com": "pauseTikTokVideos",
  };
  let key = null;
  for (const domain in AUTOPLAY_BLOCK_SITES) {
    if (location.hostname === domain || location.hostname.endsWith("." + domain)) {
      key = AUTOPLAY_BLOCK_SITES[domain];
      break;
    }
  }
  if (!key) return;

  const setFlag = (on) => {
    document.documentElement.dataset.stuckInLoopBlockAutoplay = on ? "1" : "0";
  };
  try {
    chrome.storage.local.get([key], (result) => {
      setFlag(result[key] !== undefined ? result[key] : true);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[key]) setFlag(changes[key].newValue);
    });
  } catch (e) {
    // Extension context invalidated — leave the flag unset (blocker stays off)
  }
})();
