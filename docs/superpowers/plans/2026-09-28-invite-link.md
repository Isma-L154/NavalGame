# Invitation link (#38) Implementation Plan

> Executed task by task in a single session (this project uses no parallel agents). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The host shares the room through the device's share sheet (or copies the link), and an invitee who opens the link joins in one step.

**Architecture:** Two small client changes. `LobbyView` gains a Share invite action on top of the existing copy actions. A new `HomeView` (`public/js/home.js`) owns the home screen's two modes, default and invite; `app.js` keeps the create and join handlers and tells the view which mode to show. The link format stays `/?room=CODE`, so the server is untouched.

**Tech Stack:** Vanilla ES modules, Web Share API, Clipboard API, Playwright.

## Global Constraints

- Text reaches the DOM through `textContent` only; no inline scripts, styles or handlers (CSP). New modules must be `modulepreload`ed in `index.html` (`tests/frontend/test_index.py`).
- Visibility is toggled with the `hidden` attribute (`[hidden] { display: none !important }`).
- Design tokens only (no colour literals), flat poster style, 44 px minimum touch targets for buttons.
- UI copy in English.

---

### Task 1: Share invite in the lobby

**Files:** Modify `public/index.html` (lobby actions), `public/js/lobby.js`; Test `e2e/invite.spec.js`

- [ ] **Step 1: Failing E2E tests** (`e2e/invite.spec.js`):

```js
import { expect, test } from "@playwright/test";
import { createRoom, joinRoom, newPlayer, watchConsole } from "./helpers.js";

test("the host hands the invite link to the share sheet", async ({ browser }, testInfo) => {
  const ana = await newPlayer(browser, testInfo);
  await ana.addInitScript(() => {
    navigator.share = async (data) => { window.sharedInvite = data; };
  });
  const code = await createRoom(ana, "Ana");
  await ana.getByRole("button", { name: "Share invite" }).click();
  await expect(ana.getByText("Invite shared.")).toBeVisible();
  const shared = await ana.evaluate(() => window.sharedInvite);
  expect(shared.url).toBe(new URL(`/?room=${code}`, ana.url()).href);
  expect(shared.text).toContain(code);
});

test("without a share sheet the invite link is copied", async ({ browser }, testInfo) => {
  const ana = await newPlayer(browser, testInfo, { permissions: ["clipboard-read", "clipboard-write"] });
  await ana.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "share", { value: undefined, configurable: true });
  });
  const code = await createRoom(ana, "Ana");
  await expect(ana.getByRole("button", { name: "Share invite" })).toBeHidden();
  await ana.getByRole("button", { name: "Copy invite link" }).click();
  await expect(ana.getByText("Invite link copied.")).toBeVisible();
  expect(await ana.evaluate(() => navigator.clipboard.readText())).toContain(`/?room=${code}`);
});
```

- [ ] **Step 2: Run** `npx playwright test e2e/invite.spec.js` → FAIL (no Share invite button).

- [ ] **Step 3: Implement.** In the lobby actions add `<button id="share-link" class="button button-primary" type="button" hidden>Share invite</button>` before Copy invite link. `LobbyView` shows it when `navigator.share` exists and then demotes Copy invite link to a secondary button:

```js
#share() {
  const url = this.#inviteLink();
  navigator.share({ title: "NavalGame", text: `Join my NavalGame room ${this.#code}.`, url })
    .then(() => { $("copy-feedback").textContent = "Invite shared."; })
    .catch((error) => {
      // Closing the share sheet is a choice, not a failure.
      if (error.name !== "AbortError") this.#copy(url, "Invite link copied.");
    });
}
```

- [ ] **Step 4: Run** the spec → PASS on desktop and mobile. **Commit** `feat: share the room invite through the device share sheet`.

### Task 2: Invite landing on the home screen

**Files:** Create `public/js/home.js`; modify `public/index.html` (home hero and panel, modulepreload), `public/js/app.js`, `public/styles.css`; Test `e2e/invite.spec.js`

- [ ] **Step 1: Failing E2E tests:**

```js
test("an invite link opens a one-step join", async ({ browser }, testInfo) => {
  const ana = await newPlayer(browser, testInfo);
  const bo = await newPlayer(browser, testInfo);
  const problems = [ana, bo].map(watchConsole);
  const code = await createRoom(ana, "Ana");
  await bo.goto(`/?room=${code}`);
  await expect(bo.getByRole("heading", { name: `Join room ${code}` })).toBeVisible();
  await expect(bo.getByRole("button", { name: "Create a room" })).toBeHidden();
  await expect(bo.getByLabel("Or join with a code")).toBeHidden();
  await bo.getByLabel("Your nickname").fill("Bo");
  await bo.getByLabel("Your nickname").press("Enter");
  await expect(bo.getByRole("heading", { name: "Deploy your fleet" })).toBeVisible();
  expect(problems.flat()).toEqual([]);
});

test("an invited visitor can start their own room instead", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo);
  await page.goto("/?room=ABCDEF");
  await page.getByRole("button", { name: "Start a new room instead" }).click();
  await expect(page.getByRole("heading", { name: "Sink the enemy fleet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create a room" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("a malformed room in the link shows the normal home", async ({ browser }, testInfo) => {
  const page = await newPlayer(browser, testInfo);
  await page.goto("/?room=nope");
  await expect(page.getByRole("heading", { name: "Sink the enemy fleet" })).toBeVisible();
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** Give the hero kicker, title and lede ids, and add `<button id="leave-invite" class="button button-ghost" type="button" hidden>Start a new room instead</button>` at the end of the home panel. `home.js`:

```js
import { $ } from "./dom.js";

const DEFAULT_COPY = {
  kicker: "2 players · 10 × 10 grid · 5 ships",
  title: "Sink the enemy fleet",
  lede: "Create a room, send the link to a friend, hide your ships and take turns firing. First fleet to go under loses.",
};

/** The home screen: the default welcome, or a one-step join when opened from an invite link. */
export class HomeView {
  #invitedTo = null;

  constructor({ onLeaveInvite }) {
    $("leave-invite").addEventListener("click", () => {
      this.show(null);
      onLeaveInvite();
    });
  }

  get invitedTo() {
    return this.#invitedTo;
  }

  /** Shows the invite for `code`, or the default home when `code` is null. */
  show(code) {
    this.#invitedTo = code;
    const invited = code !== null;
    $("home-kicker").textContent = invited ? "You're invited" : DEFAULT_COPY.kicker;
    $("home-title").textContent = invited ? `Join room ${code}` : DEFAULT_COPY.title;
    $("home-lede").textContent = invited
      ? "A friend opened this room for you. Choose a nickname and join the battle."
      : DEFAULT_COPY.lede;
    $("create-room").hidden = invited;
    $("room-code-field").hidden = invited;
    $("leave-invite").hidden = !invited;
    $("join-submit").classList.toggle("button-primary", invited);
    $("join-form").classList.toggle("is-invite", invited);
    if (invited) $("room-code").value = code;
  }
}
```

In `app.js`: `init()` calls `home.show(code)` for a valid `?room=` code without a saved seat, otherwise `home.show(null)`. `leaveToHome()` calls `home.show(null)`. Enter in the nickname field submits the join form in invite mode and presses Create a room otherwise. In the CSS, `.join-form.is-invite` drops its top rule and padding (it is the only action).

- [ ] **Step 4: Run** `npx playwright test` (all specs, both projects), `uv run pytest tests/frontend` → PASS. **Commit** `feat: one-step join from an invite link`.

### Task 3: Ship it

- [ ] PR (`Closes #38`), `code-review`, fix findings, CI green, squash-merge, production check of the lobby and the invite landing.
