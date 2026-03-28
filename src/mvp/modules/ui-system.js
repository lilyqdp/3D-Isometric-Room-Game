export function createUIRuntime(ctx) {
  const {
    sortedStatEl,
    catStateStatEl,
    cupStatEl,
    catnipStatEl,
    windowStatEl,
    windowBtnEl,
    resultEl,
    game,
    cat,
    cup,
    windowSill,
    getClockTime,
    endMenuEl,
    endTitleEl,
  } = ctx;

  function updateUI() {
    const clockTime = getClockTime();
    sortedStatEl.textContent = `${game.sorted} / ${game.total}`;
    catStateStatEl.textContent = cat.status;

    if (cup.broken) cupStatEl.textContent = "Broken";
    else if (cup.falling) cupStatEl.textContent = "Falling";
    else cupStatEl.textContent = "On desk";

    if (game.placeCatnipMode) {
      catnipStatEl.textContent = clockTime < game.invalidCatnipUntil ? "Invalid spot" : "Click floor to place";
    } else if (game.catnip) {
      catnipStatEl.textContent = `Active (${Math.max(0, Math.ceil(game.catnip.expiresAt - clockTime))}s)`;
    } else if (clockTime < (game.catnipNoRouteUntil || 0)) {
      catnipStatEl.textContent = "No route to catnip";
    } else if (clockTime < game.catnipCooldownUntil) {
      catnipStatEl.textContent = `Cooldown (${Math.ceil(game.catnipCooldownUntil - clockTime)}s)`;
    } else {
      catnipStatEl.textContent = "Ready";
    }

    if (windowStatEl) {
      if (windowSill?.specialFlags?.windowOpensOnButtonClick === false) {
        windowStatEl.textContent = "Disabled";
      } else if (clockTime < (game.windowOpenUntil || 0)) {
        windowStatEl.textContent = `Open (${Math.max(0, Math.ceil(game.windowOpenUntil - clockTime))}s)`;
      } else {
        windowStatEl.textContent = "Closed";
      }
    }
    if (windowBtnEl) {
      const active = clockTime < (game.windowOpenUntil || 0);
      const enabled = windowSill?.specialFlags?.windowOpensOnButtonClick !== false;
      windowBtnEl.textContent = !enabled ? "Window Disabled" : active ? "Window Open" : "Open Window";
      windowBtnEl.disabled = active || !enabled;
    }

    if (game.state === "lost") {
      endMenuEl.classList.remove("hidden");
      endTitleEl.textContent = `You Lost - ${game.reason}`;
      document.getElementById("hud").style.display = "none";
    } else if (game.state === "won") {
      endMenuEl.classList.remove("hidden");
      endTitleEl.textContent = "You Won!";
      document.getElementById("hud").style.display = "none";
    } else {
      endMenuEl.classList.add("hidden");
    }
  }
  return {
    updateUI,
  };
}
