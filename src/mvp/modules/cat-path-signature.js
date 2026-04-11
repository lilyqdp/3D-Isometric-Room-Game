export function createCatPathSignatureRuntime(ctx) {
  const { CUP_COLLISION = {} } = ctx;

  function qv(v, quantum = 0.02) {
    return Math.round(v / quantum) * quantum;
  }

  function buildTileCacheDynamicSpecs(obstacles, includePickups, clearance = 0) {
    if (!Array.isArray(obstacles) || !includePickups) return [];
    const clearancePad = Math.max(0, Number.isFinite(clearance) ? clearance : 0);
    const specs = [];
    for (const obs of obstacles) {
      const mode = String(obs?.mode || "hard");
      const isPickupObstacle = !!obs?.pickupKey;
      // Soft and pushable clutter should influence high-level planning but should not
      // churn detour/tile-cache updates every time the cat brushes them. Those are
      // handled by the lightweight runtime steering and pickup shove logic instead.
      // Exception: pickups need to appear in the live navmesh debug and on-surface
      // nav cutouts, even though they are still pushable at runtime.
      if (mode !== "hard" && !isPickupObstacle) continue;
      const navPad = Math.max(0, Number(obs?.navPad) || 0);
      const recastPad = navPad + clearancePad;
      if (obs.tag === "cup") {
        specs.push({
          key: "cup",
          kind: "cylinder",
          mode,
          x: obs.x,
          y: Number.isFinite(obs.y) ? obs.y : 0.1,
          z: obs.z,
          radius: Math.max(0.03, (obs.r || CUP_COLLISION.radius || 0.08) + recastPad),
          height: Math.max(0.12, obs.h || (CUP_COLLISION.waterHeight || 0.27)),
          navPad: recastPad,
        });
      } else if (obs.kind === "obb" && obs.pickupKey) {
        specs.push({
          key: obs.pickupKey,
          kind: "box",
          mode,
          x: obs.x,
          y: Number.isFinite(obs.y) ? obs.y : 0.1,
          z: obs.z,
          hx: Math.max(0.03, (obs.hx || 0.1) + recastPad),
          hy: Math.max(0.05, (obs.h || 0.2) * 0.5),
          hz: Math.max(0.03, (obs.hz || 0.1) + recastPad),
          angle: Number.isFinite(obs.yaw) ? obs.yaw : 0,
          navPad: recastPad,
        });
      }
    }
    return specs;
  }

  function dynamicSpecsSignature(specs) {
    if (!specs.length) return "none";
    const sorted = specs.slice().sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const parts = [];
    for (const s of sorted) {
      const mode = String(s.mode || "na");
      if (s.kind === "cylinder") {
        parts.push(
          `c:${s.key}:${mode}:${qv(s.x, 0.03)}:${qv(s.y, 0.03)}:${qv(s.z, 0.03)}:${qv(s.radius, 0.02)}:${qv(s.height, 0.03)}:${qv(s.navPad || 0, 0.01)}`
        );
      } else {
        parts.push(
          `b:${s.key}:${mode}:${qv(s.x, 0.03)}:${qv(s.y, 0.03)}:${qv(s.z, 0.03)}:${qv(s.hx, 0.02)}:${qv(s.hy, 0.02)}:${qv(s.hz, 0.02)}:${qv(s.angle, 0.04)}:${qv(s.navPad || 0, 0.01)}`
        );
      }
    }
    return parts.join("|");
  }

  function obstacleSignature(obstacles, clearance) {
    const parts = [`c:${qv(clearance)}`, `n:${obstacles.length}`];
    for (const obs of obstacles) {
      const mode = String(obs?.mode || "hard");
      const navPad = qv(obs?.navPad || 0, 0.01);
      const steerPad = qv(obs?.steerPad || 0, 0.01);
      if (obs.kind === "circle") {
        parts.push(`c:${mode}:${navPad}:${steerPad}:${qv(obs.x)}:${qv(obs.z)}:${qv(obs.r)}:${qv(obs.y || 0, 0.04)}:${qv(obs.h || 0, 0.04)}`);
      } else if (obs.kind === "obb") {
        parts.push(`o:${mode}:${navPad}:${steerPad}:${qv(obs.x)}:${qv(obs.z)}:${qv(obs.hx)}:${qv(obs.hz)}:${qv(obs.yaw || 0, 0.05)}:${qv(obs.y || 0, 0.04)}:${qv(obs.h || 0, 0.04)}`);
      } else {
        parts.push(`b:${mode}:${navPad}:${steerPad}:${qv(obs.x)}:${qv(obs.z)}:${qv(obs.hx)}:${qv(obs.hz)}:${qv(obs.y || 0, 0.04)}:${qv(obs.h || 0, 0.04)}`);
      }
    }
    return parts.join("|");
  }

  return {
    qv,
    buildTileCacheDynamicSpecs,
    dynamicSpecsSignature,
    obstacleSignature,
  };
}
