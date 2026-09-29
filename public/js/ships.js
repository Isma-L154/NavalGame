import { shipByKind } from "./fleet.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// Top-down silhouettes, one cell = 10 units, bow to the right. Flat shapes only.
const ART = {
  carrier: {
    hull: "M1 1.6H43L49.2 5 43 8.4H1z",
    deck: ["M30 2.2h6v2h-6z"],
    stripe: "M4 5.6H41",
  },
  battleship: {
    hull: "M1.5 2.4H31L38.8 5 31 7.6H1.5z",
    deck: ["M5.5 3.6h3v2.8h-3z", "M11 3.6h3v2.8h-3z", "M17 3.2h6v3.6h-6z", "M26 3.6h3v2.8h-3z"],
  },
  cruiser: {
    hull: "M1.5 2.7H22L28.8 5 22 7.3H1.5z",
    deck: ["M5 3.8h2.6v2.4H5z", "M10.5 3.4h5v3.2h-5z", "M18.5 3.8h2.6v2.4h-2.6z"],
  },
  submarine: {
    hull: "M2.5 3.6H23L28.5 5 23 6.4H2.5L1 5z",
    deck: ["M11.5 4h4.5v2h-4.5z"],
  },
  destroyer: {
    hull: "M1.5 3H13L18.8 5 13 7H1.5z",
    deck: ["M4.5 3.9h3.5v2.2H4.5z", "M10.5 4h2.2v2h-2.2z"],
  },
};

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

/** A decorative ship silhouette; its cells carry the accessible name. */
export function shipArt(kind, orientation = "horizontal") {
  const units = shipByKind(kind).length * 10;
  const vertical = orientation === "vertical";
  const svg = svgEl("svg", {
    class: "ship-art",
    viewBox: vertical ? `0 0 10 ${units}` : `0 0 ${units} 10`,
    "aria-hidden": "true",
    focusable: "false",
  });
  // Vertical ships are the same drawing turned a quarter, bow down.
  const group = svgEl("g", vertical ? { transform: "translate(10 0) rotate(90)" } : {});
  const art = ART[kind];
  group.append(svgEl("path", { class: "ship-hull", d: art.hull }));
  if (art.stripe) {
    group.append(svgEl("path", { class: "ship-stripe", d: art.stripe }));
  }
  for (const d of art.deck) group.append(svgEl("path", { class: "ship-deck", d }));
  svg.append(group);
  return svg;
}
