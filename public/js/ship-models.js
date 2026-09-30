/** Ships sit this far inside their cells, in cells; their beam is what is left of one cell. */
export const SHIP_INSET = 0.07;
export const SHIP_BEAM = 1 - 2 * SHIP_INSET;
const MID = SHIP_BEAM / 2;

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const hex = (cx, cy, r) =>
  Array.from({ length: 6 }, (_, i) => [cx + r * Math.cos((i * Math.PI) / 3), cy + r * Math.sin((i * Math.PI) / 3)]);

/** A hull from a cut stern to a pointed bow, `margin` in from each side of the footprint. */
const hull = (length, margin, bow) => [
  [0.02, margin + 0.07],
  [0.09, margin],
  [length - bow, margin],
  [length - 0.02, MID],
  [length - bow, SHIP_BEAM - margin],
  [0.09, SHIP_BEAM - margin],
  [0.02, SHIP_BEAM - margin - 0.07],
];

/** A red waterline band under a blue topside, like a painted warship. */
const banded = (points, height, deck = "hull") => [
  { points, height: 0.07, part: "waterline", top: null },
  { points, height: height - 0.07, z: 0.07, part: "hull", top: deck },
];

/** A hexagonal gun turret with its barrel pointing to the bow (`forward`) or the stern. */
const turret = (x, z, forward) => [
  { points: hex(x, MID, 0.17), height: 0.11, z, part: "gun" },
  {
    points: forward
      ? rect(x + 0.07, MID - 0.033, x + 0.4, MID + 0.033)
      : rect(x - 0.4, MID - 0.033, x - 0.07, MID + 0.033),
    height: 0.05,
    z: z + 0.03,
    part: "gun",
  },
];

/** A mast or a periscope. */
const pole = (x, z, height) => ({
  points: rect(x - 0.022, MID - 0.022, x + 0.022, MID + 0.022),
  height,
  z,
  part: "gun",
});

const MODELS = {
  carrier(length) {
    const deck = [
      [0.02, 0.16],
      [0.13, 0.03],
      [length - 0.36, 0.03],
      [length - 0.02, 0.27],
      [length - 0.02, SHIP_BEAM - 0.27],
      [length - 0.36, SHIP_BEAM - 0.03],
      [0.13, SHIP_BEAM - 0.03],
      [0.02, SHIP_BEAM - 0.16],
    ];
    const plane = (x) => ({ x, y: 0.13, w: 0.24, h: 0.24, kind: "plane" });
    return [
      { points: deck, height: 0.07, part: "waterline", top: null },
      {
        points: deck,
        height: 0.2,
        z: 0.07,
        part: "hull",
        top: "flight-deck",
        marks: [
          { x: 0.22, y: MID - 0.022, w: length - 0.75, h: 0.044, kind: "runway" },
          plane(0.31),
          plane(0.71),
          plane(1.11),
        ],
      },
      {
        points: rect(length * 0.6, SHIP_BEAM - 0.24, length * 0.76, SHIP_BEAM - 0.05),
        height: 0.28,
        z: 0.27,
        part: "bridge",
      },
      {
        points: rect(length * 0.66, SHIP_BEAM - 0.18, length * 0.69, SHIP_BEAM - 0.11),
        height: 0.2,
        z: 0.55,
        part: "gun",
      },
    ];
  },
  battleship(length) {
    const deck = 0.27;
    return [
      ...banded(hull(length, 0.11, 0.67), deck),
      { points: rect(length * 0.38, MID - 0.18, length * 0.6, MID + 0.18), height: 0.16, z: deck, part: "bridge" },
      { points: rect(length * 0.45, MID - 0.11, length * 0.56, MID + 0.11), height: 0.12, z: deck + 0.16, part: "bridge" },
      pole(length * 0.5, deck + 0.28, 0.22),
      { points: rect(length * 0.29, MID - 0.1, length * 0.35, MID + 0.1), height: 0.26, z: deck, part: "gun" },
      ...turret(length * 0.7, deck, true),
      ...turret(length * 0.84, deck, true),
      ...turret(length * 0.16, deck, false),
    ];
  },
  cruiser(length) {
    const deck = 0.22;
    return [
      ...banded(hull(length, 0.13, 0.58), deck),
      { points: rect(length * 0.38, MID - 0.16, length * 0.6, MID + 0.16), height: 0.22, z: deck, part: "bridge" },
      pole(length * 0.48, deck + 0.22, 0.2),
      { points: rect(length * 0.28, MID - 0.09, length * 0.34, MID + 0.09), height: 0.24, z: deck, part: "gun" },
      ...turret(length * 0.76, deck, true),
      ...turret(length * 0.16, deck, false),
    ];
  },
  submarine(length) {
    const margin = 0.22;
    const body = [
      [0.02, MID],
      [0.27, margin],
      [length - 0.4, margin],
      [length - 0.02, MID],
      [length - 0.4, SHIP_BEAM - margin],
      [0.27, SHIP_BEAM - margin],
    ];
    return [
      { points: body, height: 0.04, part: "waterline", top: null },
      { points: body, height: 0.09, z: 0.04, part: "sub" },
      { points: rect(length * 0.36, MID - 0.08, length * 0.52, MID + 0.08), height: 0.29, z: 0.13, part: "sub" },
      { points: rect(length * 0.39, MID - 0.16, length * 0.44, MID + 0.16), height: 0.04, z: 0.31, part: "sub" },
      pole(length * 0.47, 0.42, 0.16),
    ];
  },
  destroyer(length) {
    const deck = 0.2;
    return [
      ...banded(hull(length, 0.16, 0.49), deck),
      { points: rect(length * 0.42, MID - 0.13, length * 0.62, MID + 0.13), height: 0.22, z: deck, part: "bridge" },
      pole(length * 0.51, deck + 0.22, 0.18),
      { points: rect(length * 0.27, MID - 0.08, length * 0.35, MID + 0.08), height: 0.22, z: deck, part: "gun" },
      ...turret(length * 0.78, deck, true),
    ];
  },
};

/** The parts of a ship `length` cells long (inset already taken off), bow towards +x. */
export function shipModel(kind, length) {
  return MODELS[kind](length);
}

/**
 * How high a peg stands at `x` along a ship: on top of the highest part under it, skipping
 * poles and barrels, which are too thin to carry one.
 */
export function peakAt(parts, x) {
  let peak = 0;
  for (const { points, height, z = 0 } of parts) {
    const xs = points.map(([px]) => px);
    const ys = points.map(([, py]) => py);
    const wide = Math.max(...ys) - Math.min(...ys) >= 0.1;
    if (wide && x >= Math.min(...xs) && x <= Math.max(...xs)) peak = Math.max(peak, z + height);
  }
  return peak;
}
