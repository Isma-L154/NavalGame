import { createRoom } from "./api.js";
import { BattleView } from "./battle.js";
import { RoomConnection } from "./connection.js";
import { $ } from "./dom.js";
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
// A room that accepts the socket but never answers the join must not keep the player waiting.
const JOIN_TIMEOUT_MS = 15_000;

const game = {
  code: null,
  connection: null,
  state: null,
  // False from sending a join until the server confirms it with "joined".
  joined: false,
  // Whether this visit to the room ever got a seat; a reconnect does not reset it.
  seated: false,
  joinTimer: null,
  leaving: false,
};

const home = new HomeView({
  onLeaveInvite: () => {
    // A join may already be on its way: leave properly so it cannot hold a seat.
    leaveRoom();
    $("nickname").focus();
  },
});
const lobby = new LobbyView();
const placement = new PlacementView({
  onReady: (ships) => send({ type: "place_fleet", ships }),
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
  const sent = game.connection?.send(message) ?? false;
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
  home.setCreating(true);
  let code;
  try {
    code = await createRoom();
  } catch (error) {
    notify(error.message);
    return;
  } finally {
    creating = false;
    home.setCreating(false);
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
  game.code = code;
  game.state = null;
  game.seated = false;
  game.leaving = false;
  battle.reset();
  history.replaceState(null, "", `/?room=${code}`);

  const connection = new RoomConnection(code);
  game.connection = connection;
  connection.addEventListener("open", () => {
    setConnectionStatus(null);
    game.joined = false;
    const token = session.token(code);
    connection.send(token ? { type: "join", nickname, token } : { type: "join", nickname });
    clearTimeout(game.joinTimer);
    game.joinTimer = setTimeout(() => {
      const message = game.seated
        ? "The connection to the room was lost."
        : `Could not join room ${game.code}. Check the code or create a new room.`;
      leaveToHome(message, game.code);
    }, JOIN_TIMEOUT_MS);
  });
  connection.addEventListener("message", (event) => onMessage(event.detail, nickname));
  connection.addEventListener("reconnecting", () => setConnectionStatus("Connection lost. Reconnecting…"));
  connection.addEventListener("closed", (event) => onClosed(event.detail));
  setConnectionStatus("Connecting…");
  connection.connect();
}

function onMessage(message, nickname) {
  switch (message.type) {
    case "joined":
      clearTimeout(game.joinTimer);
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
  if (!game.joined) clearTimeout(game.joinTimer);
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
  if (game.state?.phase === "placing") placement.rejected();
  else battle.rejected();
  notify(error.message);
}

function onClosed({ code }) {
  setConnectionStatus(null);
  if (game.leaving) return;
  if (!game.seated) {
    // Closed before the room ever answered the join (unknown room, network, a room that closed).
    leaveToHome(`Could not join room ${game.code}. Check the code or create a new room.`, game.code);
  } else if (code === 4000) {
    leaveToHome("This room was opened in another tab or window.");
  } else if (code === 1008) {
    leaveToHome("The connection was closed after too many invalid messages.");
  } else if (code !== 1000 || !game.joined) {
    // The seat token is still saved: joining with this code again reclaims the seat.
    leaveToHome("The connection to the room was lost.", game.code);
  }
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
  clearTimeout(game.joinTimer);
  game.connection?.stop();
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
