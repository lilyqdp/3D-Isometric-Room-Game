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
      resultEl.textContent = `You Lost - ${game.reason}`;
      resultEl.style.color = "#ffb3b3";
    } else if (game.state === "won") {
      resultEl.textContent = "You Won - all items sorted before the knock loss.";
      resultEl.style.color = "#b8f5be";
    } else {
      resultEl.textContent = "";
    }
  }

  return {
    updateUI,
  };
}
