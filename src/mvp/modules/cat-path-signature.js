export function createCatPathSignatureRuntime(ctx) {
  const { CUP_COLLISION = {} } = ctx;

  function qv(v, quantum = 0.02) {
    return Math.round(v / quantum) * quantum;
  }

  function buildTileCacheDynamicSpecs(obstacles, includePickups) {
    if (!Array.isArray(obstacles) || !includePickups) return [];
    const specs = [];
    for (const obs of obstacles) {
      if (obs.tag === "cup") {
        specs.push({
          key: "cup",
          kind: "cylinder",
          x: obs.x,
          y: Number.isFinite(obs.y) ? obs.y : 0.1,
          z: obs.z,
          radius: Math.max(0.03, obs.r || CUP_COLLISION.radius || 0.08),
          height: Math.max(0.12, obs.h || (CUP_COLLISION.waterHeight || 0.27)),
        });
      } else if (obs.kind === "obb" && obs.pickupKey) {
        specs.push({
          key: obs.pickupKey,
          kind: "box",
          x: obs.x,
          y: Number.isFinite(obs.y) ? obs.y : 0.1,
          z: obs.z,
          hx: Math.max(0.03, obs.hx || 0.1),
          hy: Math.max(0.05, (obs.h || 0.2) * 0.5),
          hz: Math.max(0.03, obs.hz || 0.1),
          angle: Number.isFinite(obs.yaw) ? obs.yaw : 0,
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
      if (s.kind === "cylinder") {
        parts.push(
          `c:${s.key}:${qv(s.x, 0.03)}:${qv(s.y, 0.03)}:${qv(s.z, 0.03)}:${qv(s.radius, 0.02)}:${qv(s.height, 0.03)}`
        );
      } else {
        parts.push(
          `b:${s.key}:${qv(s.x, 0.03)}:${qv(s.y, 0.03)}:${qv(s.z, 0.03)}:${qv(s.hx, 0.02)}:${qv(s.hy, 0.02)}:${qv(s.hz, 0.02)}:${qv(s.angle, 0.04)}`
        );
      }
    }
    return parts.join("|");
  }

  function obstacleSignature(obstacles, clearance) {
    const parts = [`c:${qv(clearance)}`, `n:${obstacles.length}`];
    for (const obs of obstacles) {
      if (obs.kind === "circle") {
        parts.push(`c:${qv(obs.x)}:${qv(obs.z)}:${qv(obs.r)}:${qv(obs.y || 0, 0.04)}:${qv(obs.h || 0, 0.04)}`);
      } else if (obs.kind === "obb") {
        parts.push(`o:${qv(obs.x)}:${qv(obs.z)}:${qv(obs.hx)}:${qv(obs.hz)}:${qv(obs.yaw || 0, 0.05)}:${qv(obs.y || 0, 0.04)}:${qv(obs.h || 0, 0.04)}`);
      } else {
        parts.push(`b:${qv(obs.x)}:${qv(obs.z)}:${qv(obs.hx)}:${qv(obs.hz)}:${qv(obs.y || 0, 0.04)}:${qv(obs.h || 0, 0.04)}`);
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
