import { el } from "./dom.js";

// Turns are limited to 40 degrees and tilts to at least 10, so a wall facing within 40 degrees
// of the table's far edge never faces the camera: it is not built.
const HIDDEN_NORMAL_Y = -Math.cos((40 * Math.PI) / 180);
// Parts thinner than this (gun barrels, diving planes) are only a raised top face.
const MIN_WALL = 0.06;
// Walls are shaded by how much they face a light from the table's north-west.
const LIGHT = (() => {
  const [x, y] = [-0.45, -1];
  const length = Math.hypot(x, y);
  return [x / length, y / length];
})();

const em = (value) => `${Math.round(value * 1000) / 1000}em`;

/**
 * A flat-shaded prism: the polygon `points` (in em, on the piece's own axes) raised `height` em
 * from `z`. `part` names its colour (`--ship-hull`...); `top` is the top face's part, or null
 * for none; `marks` are shapes painted on the top face. `turned` says the piece lies turned a
 * quarter on the board, which decides which walls can face the camera.
 */
export function prism(points, height, { z = 0, part, top = part, marks = [], turned = false }) {
  const solid = el("div", { className: "solid" });
  solid.style.setProperty("transform", `translateZ(${em(z)})`);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const [cx, cy] = [xs.reduce((a, b) => a + b) / xs.length, ys.reduce((a, b) => a + b) / ys.length];
  if (height >= MIN_WALL) {
    points.forEach(([x1, y1], index) => {
      const [x2, y2] = points[(index + 1) % points.length];
      const length = Math.hypot(x2 - x1, y2 - y1);
      if (length < 0.005) return;
      let [nx, ny] = [(y2 - y1) / length, -(x2 - x1) / length];
      if (nx * ((x1 + x2) / 2 - cx) + ny * ((y1 + y2) / 2 - cy) < 0) [nx, ny] = [-nx, -ny];
      // A piece turned a quarter (clockwise on screen) carries its normals with it.
      const [bx, by] = turned ? [-ny, nx] : [nx, ny];
      if (by < HIDDEN_NORMAL_Y) return;
      const light = bx * LIGHT[0] + by * LIGHT[1];
      const shade = light > 0.3 ? "face-lit" : light > -0.3 ? "face-mid" : "face-dark";
      const wall = el("div", { className: `face part-${part} ${shade}` });
      wall.style.setProperty("width", em(length + 0.01));
      wall.style.setProperty("height", em(height));
      wall.style.setProperty(
        "transform",
        `translate(${em(x1)}, ${em(y1)}) rotateZ(${Math.atan2(y2 - y1, x2 - x1)}rad) rotateX(90deg)`,
      );
      solid.append(wall);
    });
  }
  if (top !== null) {
    const [minX, minY] = [Math.min(...xs), Math.min(...ys)];
    const face = el("div", { className: `face face-top part-${top}` });
    face.style.setProperty("left", em(minX));
    face.style.setProperty("top", em(minY));
    face.style.setProperty("width", em(Math.max(...xs) - minX));
    face.style.setProperty("height", em(Math.max(...ys) - minY));
    face.style.setProperty(
      "clip-path",
      `polygon(${points.map(([x, y]) => `${em(x - minX)} ${em(y - minY)}`).join(", ")})`,
    );
    face.style.setProperty("transform", `translateZ(${em(height)})`);
    for (const mark of marks) {
      const shape = el("div", { className: `mark mark-${mark.kind}` });
      shape.style.setProperty("left", em(mark.x - minX));
      shape.style.setProperty("top", em(mark.y - minY));
      shape.style.setProperty("width", em(mark.w));
      shape.style.setProperty("height", em(mark.h));
      face.append(shape);
    }
    solid.append(face);
  }
  return solid;
}
