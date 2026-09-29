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

const game = {
  code: null,
  connection: null,
  state: null,
  // False from sending a join until the server confirms it with "joined".
  joined: false,
  leaving: false,
};

const home = new HomeView({
  onLeaveInvite: () => {
    history.replaceState(null, "", "/");
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

async function onCreateRoom() {
  const nickname = readNickname();
  if (!nickname) return;
  const button = $("create-room");
  button.disabled = true;
  button.textContent = "Creating…";
  try {
    enterRoom(await createRoom(), nickname);
  } catch (error) {
    notify(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Create a room";
  }
}

function onJoinRoom(event) {
  event.preventDefault();
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
  // Already connecting to this room: a second submit would orphan the first seat.
  if (game.connection && game.code === code) return;
  enterRoom(code, nickname);
}

// Room lifecycle

function enterRoom(code, nickname) {
  clearNotice();
  game.connection?.stop();
  game.code = code;
  game.state = null;
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
      game.joined = true;
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
  if (error.code === "invalid_token") {
    // The saved seat expired and the server closes this socket: join again as a new player.
    session.clearToken(game.code);
    enterRoom(game.code, nickname);
    return;
  }
  // Before "joined", the error answers the join itself (the server then closes the socket).
  if (FATAL_ERRORS.has(error.code) || !game.joined) {
    leaveToHome(error.message);
    return;
  }
  // Whatever was pending did not happen: let the player act again.
  if (game.state?.phase === "placing") placement.rejected();
  else battle.rejected();
  notify(error.message);
}

function onClosed({ code, everOpened }) {
  setConnectionStatus(null);
  if (game.leaving) return;
  if (!everOpened) {
    leaveToHome(`Could not join room ${game.code}. Check the code or create a new room.`);
  } else if (code === 4000) {
    leaveToHome("This room was opened in another tab or window.");
  } else if (code === 1008) {
    leaveToHome("The connection was closed after too many invalid messages.");
  } else if (code !== 1000) {
    leaveToHome("The connection to the room was lost.");
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

function leaveToHome(message) {
  game.connection?.stop();
  game.connection = null;
  game.code = null;
  game.state = null;
  setConnectionStatus(null);
  history.replaceState(null, "", "/");
  home.show(null);
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
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    // Clicking the buttons keeps their guards (a disabled Create button ignores clicks).
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
