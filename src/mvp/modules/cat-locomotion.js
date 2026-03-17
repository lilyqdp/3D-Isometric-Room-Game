export const CAT_LOCOMOTION_PROFILES = Object.freeze({
  idle: { planarSpeed: 0, turnRate: 0, localX: 0, localZ: 0 },
  walkF: { planarSpeed: 0.9, turnRate: 1.1, localX: 0, localZ: 1 },
  runF: { planarSpeed: 1.45, turnRate: 1.25, localX: 0, localZ: 1 },
  walkL: { planarSpeed: 0.78, turnRate: 0.7, localX: 0.32, localZ: 0.95 },
  walkR: { planarSpeed: 0.78, turnRate: 0.7, localX: -0.32, localZ: 0.95 },
  runL: { planarSpeed: 1.22, turnRate: 0.95, localX: 0.38, localZ: 0.92 },
  runR: { planarSpeed: 1.22, turnRate: 0.95, localX: -0.38, localZ: 0.92 },
  turn45L: { planarSpeed: 0, turnRate: 0.76, localX: 0, localZ: 0 },
  turn45R: { planarSpeed: 0, turnRate: 0.76, localX: 0, localZ: 0 },
  turn90L: { planarSpeed: 0, turnRate: 1.52, localX: 0, localZ: 0 },
  turn90R: { planarSpeed: 0, turnRate: 1.52, localX: 0, localZ: 0 },
});

export function getCatLocomotionProfile(profiles, clipKey) {
  return profiles?.[clipKey] || CAT_LOCOMOTION_PROFILES[clipKey] || CAT_LOCOMOTION_PROFILES.walkF;
}
