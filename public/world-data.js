// Shared collision layout: the renderer and authoritative simulation use the same plaza.
export const WORLD = {
  limit: 22.5,
  fountain: { x: 0, z: 0, radius: 2.7 },
  planters: [
    { x: -11, z: -9, w: 4.4, d: 2.1 },
    { x: 11, z: 9, w: 4.4, d: 2.1 },
    { x: 11, z: -9, w: 4.4, d: 2.1 },
    { x: -11, z: 9, w: 4.4, d: 2.1 },
  ],
  kiosks: [
    { x: -15.5, z: 0, w: 4.2, d: 4.2 },
    { x: 15.5, z: 0, w: 4.2, d: 4.2 },
  ],
  benches: [
    { x: -5.8, z: -3.8, w: 2.8, d: 0.8 },
    { x: 5.8, z: 3.8, w: 2.8, d: 0.8 },
  ],
};
export const OBSTACLES = [
  { type: "circle", ...WORLD.fountain, height: 0.65 },
  ...WORLD.planters.map((o) => ({ type: "box", ...o, height: 0.85 })),
  ...WORLD.kiosks.map((o) => ({ type: "box", ...o, height: 3.1 })),
  ...WORLD.benches.map((o) => ({ type: "box", ...o, height: 1.1 })),
];
// Movement uses the full fountain basin and planter footprints. Sight uses their
// actual heights, with separate narrow columns for the fountain and tree trunks.
export const SIGHT_OBSTACLES = [
  ...OBSTACLES,
  { type: "circle", x: 0, z: 0, radius: 0.75, height: 2.55 },
  ...WORLD.planters.flatMap((p) =>
    [-1.1, 1.1].map((dx) => ({
      type: "circle",
      x: p.x + dx,
      z: p.z,
      radius: 0.22,
      height: 3,
    })),
  ),
];
export function isWalkable(x, z, radius = 0.36) {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(z) ||
    Math.abs(x) > WORLD.limit - radius ||
    Math.abs(z) > WORLD.limit - radius
  )
    return false;
  return !OBSTACLES.some((o) =>
    o.type === "circle"
      ? Math.hypot(x - o.x, z - o.z) < o.radius + radius
      : Math.abs(x - o.x) < o.w / 2 + radius &&
        Math.abs(z - o.z) < o.d / 2 + radius,
  );
}
