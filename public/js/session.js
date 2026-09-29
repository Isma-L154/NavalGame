// Storage can be unavailable (private mode, blocked site data); the game still works without it.
function read(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function write(storage, key, value) {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // Reconnection after a reload is a convenience; ignore storage failures.
  }
}

// Seat tokens also live here, in case sessionStorage refuses them: a lost token means a lost seat.
const tokens = new Map();

export const session = {
  get nickname() {
    return read(localStorage, "naval.nickname") ?? "";
  },
  set nickname(value) {
    write(localStorage, "naval.nickname", value);
  },
  /** The flag the player picked, or null while they have not picked one. */
  get flag() {
    return read(localStorage, "naval.flag");
  },
  set flag(value) {
    write(localStorage, "naval.flag", value);
  },
  /** Seat tokens live in sessionStorage: per tab, gone when the tab closes. */
  token(code) {
    return read(sessionStorage, `naval.token.${code}`) ?? tokens.get(code) ?? null;
  },
  saveToken(code, token) {
    tokens.set(code, token);
    write(sessionStorage, `naval.token.${code}`, token);
  },
  clearToken(code) {
    tokens.delete(code);
    write(sessionStorage, `naval.token.${code}`, null);
  },
};
