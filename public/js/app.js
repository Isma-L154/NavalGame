import { createRoom } from "./api.js";
import { BattleView } from "./battle.js";
import { RoomConnection } from "./connection.js";
import { $ } from "./dom.js";
import { FlagPicker } from "./flag-picker.js";
import { flagForNickname, flagName } from "./flags.js";
import { HomeView } from "./home.js";
import { LobbyView } from "./lobby.js";
import { clearNotice, notify, setConnectionStatus } from "./notice.js";
import { PlacementView } from "./placement.js";
import { session } from "./session.js";

const NICKNAME = /^[A-Za-z0-9_-](?:[A-Za-z0-9 _-]{0,18}[A-Za-z0-9_-])?$/;
const ROOM_CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
const SCREENS = ["home", "lobby", "placement", "battle"];

// Errors that end this visit to the room rather than a single action.
const FATAL_ERRORS = new Set(["room_full", "room_closed"]);

const game = {
  code: null,
  connection: null,
  state: null,
  // False from sending a join until the server confirms it with "joined".
  joined: false,
  // Whether this visit to the room ever got a seat; a reconnect does not reset it.
  seated: false,
  // The flag asked for by a fresh join, to explain it if the server gave another one.
  requestedFlag: null,
  // A flag chosen while placing ships, remembered as the player's pick once the server agrees.
  chosenFlag: null,
  // Sent with every join of this visit made without a token: if the reply carrying the token is
  // lost, the next join gets the same seat back instead of a second one.
  joinId: null,
  leaving: false,
};

const home = new HomeView({
  onLeaveInvite: () => {
    // A join may already be on its way: leave properly so it cannot hold a seat.
    leaveRoom();
    $("nickname").focus();
  },
});
// Whether the player picked a flag, kept in memory too: storage can be unavailable.
let flagPicked = false;
const homeFlag = new FlagPicker($("home-flag"), {
  name: "home-flag",
  onChange: (flag) => {
    flagPicked = true;
    session.flag = flag;
  },
});
const lobby = new LobbyView();
const placement = new PlacementView({
  onReady: (ships) => send({ type: "place_fleet", ships }),
  onChooseFlag: (flag) => {
    if (send({ type: "choose_flag", flag })) game.chosenFlag = flag;
  },
});
const battle = new BattleView({
  onFire: (row, col) => send({ type: "fire", row, col }),
  onRematch: () => send({ type: "rematch" }),
});

function showScreen(name) {
  for (const screen of SCREENS) $(`screen-${screen}`).hidden = screen !== name;
}

function send(message) {
  clearNotice();
  // Until the room answers the join, a message would act for a seat the page may not hold yet.
  const sent = game.joined && (game.connection?.send(message) ?? false);
  if (!sent) notify("Not connected. Trying to reconnect…");
  return sent;
}

// Home

function readNickname() {
  const input = $("nickname");
  const nickname = input.value;
  const valid = NICKNAME.test(nickname);
  input.setAttribute("aria-invalid", String(!valid));
  if (!valid) {
    notify("Choose a nickname: 1–20 letters, digits, spaces, _ or -, not starting or ending with a space.");
    input.focus();
    return null;
  }
  session.nickname = nickname;
  return nickname;
}

let creating = false;

/** While a room is being created or joined, a second one would orphan the seat being taken. */
const busy = () => creating || game.connection !== null;

async function onCreateRoom() {
  if (busy()) return;
  const nickname = readNickname();
  if (!nickname) return;
  creating = true;
  home.setBusy(true, { creating: true });
  let code;
  try {
    code = await createRoom();
  } catch (error) {
    home.setBusy(false);
    notify(error.message);
    return;
  } finally {
    creating = false;
  }
  enterRoom(code, nickname);
}

function onJoinRoom(event) {
  event.preventDefault();
  if (busy()) return;
  const nickname = readNickname();
  if (!nickname) return;
  const input = $("room-code");
  const code = input.value.trim().toUpperCase();
  const valid = ROOM_CODE.test(code);
  input.setAttribute("aria-invalid", String(!valid));
  if (!valid) {
    notify("Room codes have 6 characters (letters and digits, without 0, 1, I, L or O).");
    input.focus();
    return;
  }
  enterRoom(code, nickname);
}

// Room lifecycle

function enterRoom(code, nickname) {
  clearNotice();
  game.connection?.stop();
  home.setBusy(true);
  game.code = code;
  game.state = null;
  game.seated = false;
  game.joinId = newJoinId();
  game.leaving = false;
  battle.reset();
  placement.setFlagNote(null);
  history.replaceState(null, "", `/?room=${code}`);

  const connection = new RoomConnection(code);
  game.connection = connection;
  // Whether the latest join on this connection was a fresh one, without a seat token.
  let freshJoin = false;
  connection.addEventListener("open", () => {
    setConnectionStatus(null);
    game.joined = false;
    const token = session.token(code);
    freshJoin = !token;
    const flag = homeFlag.value;
    // A returning seat keeps its flag, so only a fresh join can be given another one.
    game.requestedFlag = token ? null : flag;
    connection.send(
      token ? { type: "join", nickname, token, flag } : { type: "join", nickname, flag, join_id: game.joinId },
    );
  });
  connection.addEventListener("message", (event) => {
    if (event.detail.type === "joined") connection.confirm();
    onMessage(event.detail, nickname);
  });
  connection.addEventListener("unanswered", () => {
    // A fresh join may still be processed later: leave, so it cannot keep a seat. A returning
    // player keeps theirs (and the token) to try again.
    if (freshJoin) connection.send({ type: "leave" });
    leaveUnreachable();
  });
  connection.addEventListener("reconnecting", () => setConnectionStatus("Connection lost. Reconnecting…"));
  connection.addEventListener("closed", (event) => onClosed(event.detail));
  setConnectionStatus("Connecting…");
  connection.connect();
}

/** 32 random bytes, URL-safe base64 without padding: the same shape as a seat token. */
function newJoinId() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function onMessage(message, nickname) {
  switch (message.type) {
    case "joined":
      game.joined = true;
      game.seated = true;
      if (message.token) session.saveToken(game.code, message.token);
      break;
    case "state":
      onState(message);
      break;
    case "shot":
      battle.recordShot(message, game.state);
      break;
    case "error":
      onError(message, nickname);
      break;
    default:
      break;
  }
}

function onState(state) {
  const previous = game.state;
  game.state = state;
  const flown = state.players[state.seat].flag;
  if (game.requestedFlag && flown !== game.requestedFlag) {
    placement.setFlagNote(game.requestedFlag, flown);
  }
  game.requestedFlag = null;
  if (flown === game.chosenFlag) {
    flagPicked = true;
    session.flag = flown;
    homeFlag.setValue(flown);
    game.chosenFlag = null;
  }
  if (previous?.phase === "finished" && state.phase === "placing") battle.reset();
  const opponent = state.players[1 - state.seat];
  if (state.phase === "placing" && !opponent) {
    lobby.update(state);
    showScreen("lobby");
  } else if (state.phase === "placing") {
    placement.update(state);
    showScreen("placement");
  } else {
    battle.update(state);
    showScreen("battle");
  }
}

function onError(error, nickname) {
  if (error.code === "invalid_token") {
    // The saved seat expired and the server closes this socket: join again as a new player.
    session.clearToken(game.code);
    enterRoom(game.code, nickname);
    return;
  }
  if (FATAL_ERRORS.has(error.code)) {
    leaveToHome(error.message);
    return;
  }
  // Before "joined", the error answers the join itself (the server then closes the socket).
  if (!game.joined) {
    leaveToHome(error.message, game.code);
    return;
  }
  // Whatever was pending did not happen: let the player act again.
  if (game.state?.phase === "placing") placement.rejected(error.code);
  else battle.rejected();
  notify(error.message);
}

function onClosed({ code }) {
  setConnectionStatus(null);
  if (game.leaving) return;
  if (code === 4000) {
    leaveToHome("This room was opened in another tab or window.");
  } else if (code === 1008) {
    leaveToHome("The connection was closed after too many invalid messages.");
  } else {
    // The connection has stopped for good (no retries left, or a close the room did not
    // explain): this visit is over either way.
    leaveUnreachable();
  }
}

/**
 * Back home after the room could not be reached, with the code kept for another try. The message
 * depends on what is known: a seat held this visit is not lost yet; a saved token for a room
 * never reached may still be good (or the room may be gone); without either, check the code.
 */
function leaveUnreachable() {
  const code = game.code;
  const reached = game.connection?.everOpened ?? false;
  let message = `Could not join room ${code}. Check the code or create a new room.`;
  if (game.seated || (reached && session.token(code))) {
    message = "The connection to the room was lost.";
  } else if (session.token(code)) {
    message = `Could not reach room ${code}. Try joining again in a moment.`;
  }
  leaveToHome(message, code);
}

function leaveRoom() {
  if (game.code) {
    game.leaving = true;
    game.connection?.send({ type: "leave" });
    session.clearToken(game.code);
  }
  leaveToHome(null);
}

/** `retryCode` keeps a room's code in the join field, for when trying again makes sense. */
function leaveToHome(message, retryCode = null) {
  game.connection?.stop();
  home.setBusy(false);
  game.connection = null;
  game.code = null;
  game.state = null;
  setConnectionStatus(null);
  history.replaceState(null, "", "/");
  home.show(null, { retryCode });
  showScreen("home");
  if (message) notify(message);
}

// Start

function init() {
  $("nickname").value = session.nickname;
  const stored = session.flag;
  flagPicked = Boolean(stored && flagName(stored));
  homeFlag.setValue(flagPicked ? stored : flagForNickname(session.nickname));
  // Until the player picks a flag, it follows the nickname's first letter.
  $("nickname").addEventListener("input", (event) => {
    if (!flagPicked) homeFlag.setValue(flagForNickname(event.target.value));
  });
  $("create-room").addEventListener("click", onCreateRoom);
  $("join-form").addEventListener("submit", onJoinRoom);
  $("room-code").addEventListener("input", (event) => {
    event.target.value = event.target.value.toUpperCase();
  });
  // The nickname sits outside the join form: Enter triggers whichever action is on offer.
  $("nickname").addEventListener("keydown", (event) => {
    // keyCode 229: Safari reports the Enter that commits an IME composition this way.
    if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (event.repeat) return;
    const joining = home.invitedTo || $("room-code").value.trim();
    $(joining ? "join-submit" : "create-room").click();
  });
  for (const button of document.querySelectorAll(".leave-button")) {
    button.addEventListener("click", leaveRoom);
  }

  const code = new URLSearchParams(location.search).get("room")?.toUpperCase();
  const room = code && ROOM_CODE.test(code) ? code : null;
  showScreen("home");
  // Coming back to a room this tab already sits in (a reload): reconnect straight away.
  if (room && session.token(room) && NICKNAME.test(session.nickname)) {
    home.show(null);
    enterRoom(room, session.nickname);
    return;
  }
  home.show(room);
  if (room) $("nickname").focus();
}

init();
