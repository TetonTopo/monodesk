# Monodesk

Gmail, Notion, Claude and WhatsApp in one quiet window, with a Home screen that shows what needs you. Each app is the real website, signed in as you.

## Install (Windows, about 5 minutes)

1. Install **Node.js LTS** from https://nodejs.org (the big green button; accept the defaults).
2. Download **https://github.com/TetonTopo/monodesk/archive/refs/heads/main.zip**, unzip it, and move the `monodesk-main` folder somewhere permanent, for example `Documentsmonodesk`. Don't run it from inside the zip or from Downloads you clean out. (If you use git: `git clone https://github.com/TetonTopo/monodesk` works too.)
3. Double-click **Start Monodesk.cmd**. The first time it downloads Electron (about 100 MB, a minute or two), then Monodesk opens and the console window closes on its own.
4. From then on, open it from the **Monodesk** shortcut it makes in the folder and in the Start menu. To keep it on the taskbar, right-click Monodesk there and pick **Pin to taskbar**.

On a Mac: install Node.js, then in Terminal run `npm install` and `npm start` inside the folder.

## First-time setup

- **Sign in once** in each app (Mail, Notion, Co-work, WhatsApp). Sign-ins are saved on your own computer.
- **WhatsApp:** scan the QR code with your phone (WhatsApp → Settings → Linked devices).
- **Gmail:** Settings → Themes → Dark looks best in Mono mode. For unread mail on top: Settings → See all settings → Inbox → Inbox type → **Unread first**.
- Claude, Notion and WhatsApp follow Mono mode on their own if their theme is set to "System".

## What's where

**Top bar:** the **𝕸** shows your version and updates Monodesk (see below). Then Home, Mail, Notion, Co-work, Claude Code, WhatsApp, Calendar (Google Calendar, signed in with the Mail tab), then **+** (new to-do, if set up). Numbers on an icon are unread counts; on Co-work and Claude Code they count tabs where Claude finished replying while you were elsewhere. The **Mono / Color** button on the right switches between grey and each app's own colours.

**Meetings:** today's meetings on your own calendar (timed ones, not all-day events) sit next to the date on Home ("University of Regina meeting · 8:30am"); in the other apps, the next one shows in grey beside the search button. They come from Google Calendar using the Mail tab's sign-in, so sign in to Gmail there first.

**Home:**
- **WhatsApp:** unread chats on top, then your pinned chats. **Reply** sends a message without leaving Home, **Read** marks a chat read. Pin a chat by opening it in WhatsApp and pressing the pin on the panel; press again to unpin.
- **Mail:** the latest important unread email in your Primary inbox (automated senders are skipped). **Mark as read** works while the Mail tab is showing your inbox.
- **Notion:** a live copy of one page. Open a page in Notion and press the pin to show it here.
- **Claude:** with the **Dispatch** switch on, your three most recent Claude chats and Code sessions, like the Dispatch phone app: click one to read and reply, **New chat** and **All threads** in the fourth corner, and **Open** (on hover) to open it in Monodesk's Claude tab. **Run inbox triage** starts a triage there. With the switch off, it's the inbox-triage chat instead: **Run now**, **Open in Claude**, and a line that asks Claude anything.

**Tabs:** Mail, Notion and Claude keep several tabs (Ctrl T new, Ctrl W close, middle-click closes). Co-work and Claude Code keep separate tabs, so switching never loses your place. Links to Notion, Gmail or Claude open in the right app's tab; other links open in your normal browser.

## Shortcuts

| Action | Keys |
| --- | --- |
| Search and commands | Ctrl K |
| Home, Mail, Notion, Co-work, Claude Code, WhatsApp, Calendar | Ctrl 1–7 |
| In Claude: number recent chats / jump to one | Hold Alt / Alt 1–9 |
| New tab / close tab | Ctrl T / Ctrl W |
| Split view (two apps side by side) | Ctrl \ |
| Copy the open WhatsApp chat as text | Ctrl Shift E |

## Make it yours

Open **config.js** in Notepad (Monodesk makes it from `config.example.js` the first time it starts; updates never change it):
- `todoBoard`: link to your Notion to-do board (a database shown as a board). The **+** adds a card to it. Leave it `''` to hide the +.
- `todoColumn`: which column the + adds to, for example `'Soon'`. Notion hides empty columns, so keep at least one card in it.
- `triagePrompt`: what **Run now** sends to Claude. If you have a Claude skill for this, name it here (for example `'Run my inbox triage'`).

Save the file and Monodesk reloads by itself. Changes to the other files (style.css, renderer.js, main.js) also apply live while Monodesk is open, so you can ask Claude Code to change things and watch them happen.

## Updating

Click the **𝕸** in the top-left corner. It shows the version you're on and checks GitHub; when a newer one is out, the 𝕸 gets an orange dot and the menu has an **Update** button. Update downloads the new version (or runs `git pull` in a git checkout), keeps your `config.js` and sign-ins, and restarts Monodesk. Dispatch, if it's installed next to Monodesk, updates too.

**Publishing a new version** (for whoever maintains Monodesk): make the change, raise `version` in `package.json` (0.2.0 → 0.2.1), commit and push to `main`. Everyone's 𝕸 shows the update within six hours, or right away when they click it.

## Dispatch (Claude on your iPhone)

Monodesk runs a small server on `127.0.0.1:47800` for [Dispatch](https://github.com/TetonTopo/dispatch), a phone app for your recent Claude chats and Claude Code sessions. It uses Monodesk's Claude sign-in, so Monodesk has to be running on the PC.

1. Clone Dispatch next to this folder: in `Documents`, run `git clone https://github.com/TetonTopo/dispatch`. Monodesk looks for `..\dispatch`. To keep it somewhere else, set the `MONODESK_DISPATCH` environment variable to that folder.
2. Share the server on your tailnet: `tailscale serve --bg 47800`. Only devices signed in to your Tailscale can reach it.
3. On the iPhone, see the Dispatch README to add it to the home screen.

## Privacy

The folder holds only code. Your sign-ins, cookies, pinned chats and drafts live in `%APPDATA%\Monodesk` on your own computer and are never in the folder or the zip. Sharing the folder shares nothing personal. To sign everything out on a computer, quit Monodesk and delete `%APPDATA%\Monodesk`.

## If something's off

- **WhatsApp panel says loading:** open the WhatsApp tab once; it needs to finish syncing.
- **Mail panel is empty:** sign in to Gmail in the Mail tab.
- **A Home button stops working** after Gmail, WhatsApp or Notion changes their page: tell DK. These features read the real websites, so a redesign can need a small fix.
- **Start Monodesk.cmd flashes and nothing opens:** Node.js isn't installed, or the folder was moved. Reinstall Node, then run Start Monodesk.cmd again.
