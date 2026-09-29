const SVG_NS = "http://www.w3.org/2000/svg";

/** The letter flags of the International Code of Signals, by their spoken names. */
export const FLAGS = [
  "Alfa", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliett",
  "Kilo", "Lima", "Mike", "November", "Oscar", "Papa", "Quebec", "Romeo", "Sierra", "Tango",
  "Uniform", "Victor", "Whiskey", "X-ray", "Yankee", "Zulu",
].map((name) => ({ code: name[0].toLowerCase(), name }));

export const flagName = (code) => FLAGS.find((flag) => flag.code === code)?.name ?? "";

/** The flag of the nickname's first letter, so a new player starts with a flag of their own. */
export function flagForNickname(nickname) {
  const initial = nickname.trim()[0]?.toLowerCase();
  return FLAGS.some((flag) => flag.code === initial) ? initial : "a";
}

/** A decorative flag drawn from the shared sprite; the name must be given as text alongside. */
export function flagIcon(code, className = "flag") {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `/flags.svg#flag-${code}`);
  svg.append(use);
  return svg;
}
