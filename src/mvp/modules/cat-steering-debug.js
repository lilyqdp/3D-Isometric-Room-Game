export function createCatSteeringDebugRuntime(ctx) {
  const { cat, getClockTime } = ctx;

  function ensureNavDebugStore() {
    if (!cat.nav.debugStep || typeof cat.nav.debugStep !== "object") cat.nav.debugStep = {};
    if (!cat.nav.debugCounters || typeof cat.nav.debugCounters !== "object") {
      cat.nav.debugCounters = {
        noPath: 0,
        noSteer: 0,
        repath: 0,
        escape: 0,
        rollback: 0,
        rescueSnap: 0,
        turnOnlyRepath: 0,
        segmentRescue: 0,
      };
    }
    if (!Array.isArray(cat.nav.debugEvents)) cat.nav.debugEvents = [];
    if (!Number.isFinite(cat.nav.segmentBlockedFrames)) cat.nav.segmentBlockedFrames = 0;
    if (!Number.isFinite(cat.nav.segmentBlockRepathAt)) cat.nav.segmentBlockRepathAt = 0;
    if (!Number.isFinite(cat.nav.segmentBlockEventAt)) cat.nav.segmentBlockEventAt = 0;
    if (typeof cat.nav.segmentBlockSignature !== "string") cat.nav.segmentBlockSignature = "";
    if (!Number.isFinite(cat.nav.staleInvalidFrames)) cat.nav.staleInvalidFrames = 0;
    if (!Number.isFinite(cat.nav.wholePathBlockedFrames)) cat.nav.wholePathBlockedFrames = 0;
    if (!Number.isFinite(cat.nav.wholePathBlockRetryAt)) cat.nav.wholePathBlockRetryAt = 0;
    if (!Number.isFinite(cat.nav.wholePathBlockEventAt)) cat.nav.wholePathBlockEventAt = 0;
    if (!Number.isFinite(cat.nav.wholePathValidateAt)) cat.nav.wholePathValidateAt = 0;
    if (!cat.nav.debugRepathReasons || typeof cat.nav.debugRepathReasons !== "object") {
      cat.nav.debugRepathReasons = {};
    }
    if (!cat.nav.lastRepathCause || typeof cat.nav.lastRepathCause !== "object") {
      cat.nav.lastRepathCause = {
        t: 0,
        kind: "none",
        state: "",
      };
    }
  }

  function bumpDebugCounter(name) {
    ensureNavDebugStore();
    cat.nav.debugCounters[name] = (cat.nav.debugCounters[name] || 0) + 1;
  }

  function recordNavEvent(kind, data = null) {
    ensureNavDebugStore();
    const evt = {
      t: getClockTime(),
      kind,
      state: cat.state,
    };
    if (data && typeof data === "object") Object.assign(evt, data);
    cat.nav.debugEvents.push(evt);
    if (cat.nav.debugEvents.length > 160) {
      cat.nav.debugEvents.splice(0, cat.nav.debugEvents.length - 160);
    }
  }

  function markRepathCause(kind, data = null) {
    ensureNavDebugStore();
    cat.nav.debugRepathReasons[kind] = (cat.nav.debugRepathReasons[kind] || 0) + 1;
    cat.nav.lastRepathCause = {
      t: getClockTime(),
      kind,
      state: cat.state,
      ...(data && typeof data === "object" ? data : null),
    };
    recordNavEvent(`repath-cause:${kind}`, data);
  }

  return {
    ensureNavDebugStore,
    bumpDebugCounter,
    recordNavEvent,
    markRepathCause,
  };
}
