import { el } from "./dom.js";
import { FLAGS, flagIcon, flagName } from "./flags.js";

/**
 * The player's flag: a disclosure showing the current one, opening a radio group of all 26.
 * Native radios give the keyboard and screen-reader behaviour for free.
 */
export class FlagPicker {
  #radios = new Map();
  #current = el("span", { className: "flag-picker-current" });

  constructor(container, { name, onChange }) {
    const options = el("div", { className: "flag-options" });
    for (const flag of FLAGS) {
      const radio = el("input", { attrs: { type: "radio", name, value: flag.code } });
      radio.addEventListener("change", () => {
        this.#show(flag.code);
        onChange(flag.code);
      });
      this.#radios.set(flag.code, radio);
      options.append(
        el("label", { className: "flag-option" }, [radio, flagIcon(flag.code), el("span", { text: flag.name })]),
      );
    }
    const summary = el("summary", { className: "flag-picker-summary" }, [
      el("span", { className: "field-label", text: "Your flag" }),
      this.#current,
    ]);
    const fieldset = el("fieldset", { className: "flag-picker-options" }, [
      el("legend", { className: "visually-hidden", text: "Choose your flag" }),
      options,
    ]);
    this.root = el("details", { className: "flag-picker" }, [summary, fieldset]);
    container.replaceChildren(this.root);
  }

  get value() {
    return [...this.#radios.values()].find((radio) => radio.checked)?.value ?? null;
  }

  /** Shows `code` as chosen, without reporting a change; null shows no flag. */
  setValue(code) {
    for (const [value, radio] of this.#radios) radio.checked = value === code;
    this.#show(code);
  }

  /** Makes the opponent's flag unavailable (null: every flag is free). */
  setTaken(code) {
    for (const [value, radio] of this.#radios) radio.disabled = value === code;
  }

  #show(code) {
    this.#current.replaceChildren(
      ...(code ? [flagIcon(code), el("span", { text: flagName(code) })] : [el("span", { text: "None yet" })]),
    );
  }
}
