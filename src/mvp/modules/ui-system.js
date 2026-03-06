export function createUIRuntime(ctx) {
  const {
    sortedStatEl,
    catStateStatEl,
    cupStatEl,
    catnipStatEl,
    resultEl,
    game,
    cat,
    cup,
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
    } else if (clockTime < game.catnipCooldownUntil) {
      catnipStatEl.textContent = `Cooldown (${Math.ceil(game.catnipCooldownUntil - clockTime)}s)`;
    } else {
      catnipStatEl.textContent = "Ready";
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
