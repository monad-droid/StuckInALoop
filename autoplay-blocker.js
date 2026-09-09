// Runs in the page's MAIN world at document_start on autoplay-blocked sites.
// Gated by the data-stuck-in-loop-block-autoplay attribute maintained by
// autoplay-flag.js, so the popup toggle applies without a page reload.
//
// Two mechanisms share one gesture clock (they MUST stay in the same world —
// split trackers can disagree and fight the site's player):
// 1. HTMLMediaElement.play() is wrapped: calls without a recent user gesture
//    reject with the same NotAllowedError the browser's own autoplay policy
//    produces. Players (X, Instagram, ...) handle that gracefully — they show
//    the play button and stop retrying — unlike an external pause(), which
//    they fight by immediately replaying.
// 2. A capture-phase play listener pauses videos the wrap can't see (native
//    autoplay-attribute playback). Any retry the site makes goes through the
//    wrapped play() and is cleanly rejected, so no flicker loop can form.
(() => {
  if (window.__stuckInLoopPlayWrapped) return;
  window.__stuckInLoopPlayWrapped = true;

  const GESTURE_WINDOW_MS = 1000;
  let lastGestureTime = 0;
  // Only trust real input: a page can dispatch synthetic pointer/key events,
  // and must not be able to fake a "user gesture" to bypass the blocker.
  const markGesture = (e) => { if (e.isTrusted) lastGestureTime = Date.now(); };
  window.addEventListener("pointerdown", markGesture, true);
  window.addEventListener("keydown", markGesture, true);

  const blocking = () => document.documentElement.dataset.stuckInLoopBlockAutoplay === "1";
  const inGestureWindow = () => Date.now() - lastGestureTime < GESTURE_WINDOW_MS;

  // Videos the user deliberately started. Later play() calls on an approved
  // element (loop restart, replay after ended, buffering recovery) are part
  // of playback the user chose — blocking them wedges the player.
  const approved = new WeakSet();
  // Approval is per-content: when the element loads a different resource
  // (feed players are recycled across posts), it must re-earn approval.
  const unapprove = (e) => { approved.delete(e.target); };
  window.addEventListener("loadstart", unapprove, true);
  window.addEventListener("emptied", unapprove, true);

  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (blocking() && this instanceof HTMLVideoElement) {
      if (inGestureWindow()) {
        approved.add(this);
      } else if (!approved.has(this)) {
        return Promise.reject(new DOMException(
          "play() can only be initiated by a user gesture.",
          "NotAllowedError"
        ));
      }
    }
    return origPlay.apply(this, arguments);
  };

  // Fallback for playback that never calls play() (autoplay attribute)
  window.addEventListener("play", (e) => {
    if (!blocking()) return;
    const video = e.target;
    if (!(video instanceof HTMLVideoElement)) return;
    if (inGestureWindow()) { approved.add(video); return; } // user-initiated
    if (approved.has(video)) return; // continuation of chosen playback
    video.pause();
  }, true);

  // When the toggle flips on mid-session, stop anything already playing
  new MutationObserver(() => {
    if (!blocking()) return;
    document.querySelectorAll("video").forEach((v) => {
      if (!v.paused) v.pause();
    });
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-stuck-in-loop-block-autoplay"],
  });
})();
