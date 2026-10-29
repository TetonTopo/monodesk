# Monodesk

Gmail, Notion, Claude and WhatsApp in one quiet window, with a Home screen that shows what needs you. Each app is the real website, signed in as you.

## Install (Windows, about 5 minutes)

1. Install **Node.js LTS** from https://nodejs.org (the big green button; accept the defaults).
2. Download **https://github.com/TetonTopo/monodesk/archive/refs/heads/main.zip**, unzip it, and move the `monodesk-main` folder somewhere permanent, for example `Documents\monodesk`. Don't run it from inside the zip or from Downloads you clean out. (If you use git: `git clone https://github.com/TetonTopo/monodesk` works too.)
3. Double-click **Start Monodesk.cmd**. The first time it downloads Electron (about 100 MB, a minute or two), then Monodesk opens and the console window closes on its own.
4. From then on, open it from the **Monodesk** shortcut it makes in the folder and in the Start menu. To keep it on the taskbar, right-click Monodesk there and pick **Pin to taskbar**.
5. Closing the window doesn't quit Monodesk: it keeps running in the tray (the icons by the clock), so your apps stay signed in and Dispatch keeps working. Click the tray icon to bring it back, or right-click it for **Start with Windows** and **Quit Monodesk**. Starting Monodesk again just brings back the one that's running.

On a Mac: install Node.js, then in Terminal run `npm install` and `npm start` inside the folder.

## First-time setup

- **Sign in once** in each app (Mail, Notion, Co-work, WhatsApp). Sign-ins are saved on your own computer.
- **WhatsApp:** scan the QR code with your phone (WhatsApp → Settings → Linked devices).
- **Gmail:** Settings → Themes → Dark suits Color; in Mono, Monodesk recolours Gmail in paper and ink itself. For unread mail on top: Settings → See all settings → Inbox → Inbox type → **Unread first**.
- Claude, Notion and WhatsApp: set their theme to "System" (or "Use device setting"), so they are dark in Color. In Mono, Monodesk recolours each app itself: the page, panels, text and lines turn to paper and ink, while emoji, photos and small coloured accents keep their colour. The colours are in the `themes` folder (one small file per app, plus `palette.css`); saving one changes the open apps at once.

## What's where

**Top bar:** the **𝕸** shows your version and updates Monodesk (see below). Then Home, Mail, Notion, Co-work, Claude Code, WhatsApp, Google Calendar (signed in with the Mail tab), your private Timeline if `timelineUrl` is set in config.js, then **+** (new to-do, if set up). Numbers on an icon are unread counts; on Co-work and Claude Code they count tabs where Claude finished replying while you were elsewhere. Monodesk opens in **Color** (each app's own colours, in its dark theme); the **Mono / Color** button on the right switches to Mono: a flat warm paper page with near-black text and clear lines, in Monodesk and inside the apps.

**Sleep an app:** when one app is lagging or using too much bandwidth (say, on a call), **Shift-click** its icon in the top bar to put it to sleep, and Shift-click again to wake it. Shift-clicking never switches apps. Asleep, the app's pages are unloaded: it uses no memory and no network, and the rest keep working. Its icon is dimmed, Home's panel for it says it's asleep, and opening it shows a **Wake** button. Waking reloads its tabs where they were (an open draft that wasn't saved is lost). Co-work and Claude Code sleep separately, apps stay asleep across restarts, and Dispatch keeps working whether Claude is asleep or not (it has its own hidden Claude windows). Opening a link or thread in a sleeping app wakes it.

**What each app is using:** the **𝕸** menu lists every app with its live download and upload rate, how much it has downloaded since Monodesk started, CPU and memory, refreshed every two seconds while the menu is open, plus a sleep switch for each. **Dispatch bridge** is the phone app's hidden Claude windows; **Monodesk** is the shell itself plus Chromium's shared processes (browser, graphics, network). Network is counted inside Monodesk (including WhatsApp's live connection), so it won't match Task Manager exactly, but it shows which app is the heavy one; upload is approximate.

**Zoom:** Ctrl + and Ctrl − make everything bigger or smaller, the top bar and every app at once, wherever you press them; Ctrl 0 goes back to 100%. Monodesk remembers the size.

**Meetings:** today's meetings on your own calendar (timed ones, not all-day events) sit next to the date on Home ("University of Regina meeting · 8:30am"); in the other apps, the next one shows in grey beside the search button. They come from Google Calendar using the Mail tab's sign-in, so sign in to Gmail there first.

**Home:**
- **WhatsApp:** unread chats on top, then your pinned chats. **Reply** sends a message without leaving Home, **Read** marks a chat read. Pin a chat by opening it in WhatsApp and pressing the pin on the panel; press again to unpin.
- **Mail:** the latest important unread email in your Primary inbox (automated senders are skipped). **Mark as read** works while the Mail tab is showing your inbox.
- **Notion:** a live copy of one of your Notion Favorites (the Favorites in Notion's sidebar), which sit along the panel's top bar: click one to show it. Add or remove a favourite in Notion and the row follows within a couple of minutes. If Monodesk can't read your Favorites (Notion signed out or still loading), the row shows pages you starred here instead: open the page in Notion and press the star (press it again to take it off); hover one for its × to remove it.
- **Claude:** with the **Dispatch** switch on, your three most recent Claude chats and Code sessions, like the Dispatch phone app: click one to read and reply, **New chat** and **All threads** in the fourth corner, and **Open** (on hover) to open it in Monodesk's Claude tab. **Run inbox triage** starts a triage there. With the switch off, it's the inbox-triage chat instead: **Run now**, **Open in Claude**, and a line that asks Claude anything.

**Tabs:** Mail, Notion and Claude keep several tabs (Ctrl T new, Ctrl W close, middle-click closes). Co-work and Claude Code keep separate tabs, so switching never loses your place. Links to Notion, Gmail or Claude open in the right app's tab; other links open in your normal browser.

## Shortcuts

| Action | Keys |
| --- | --- |
| Search and commands | Ctrl K |
| Home | Alt ` (the key left of 1) |
| Mail, Notion, Co-work, Claude Code, WhatsApp, Google Calendar | Alt 1–6 |
| Timeline (only if `timelineUrl` is set in your config.js) | Alt 7 |
| From any other program: bring up Monodesk / bring it up on an app | Ctrl Alt M / Ctrl Alt ` and Ctrl Alt 1–7 |
| Show each app's number in the top bar | Hold Alt |
| In Claude: number recent chats / jump to one (1 = most recent) / start a new one | Hold Ctrl / Ctrl 1–9 / Ctrl ` |
| New tab / close tab | Ctrl T / Ctrl W |
| Split view (two apps side by side) | Ctrl \ |
| Copy the open WhatsApp chat as text | Ctrl Shift E |
| Zoom all of Monodesk in / out / back to 100% | Ctrl + / Ctrl − / Ctrl 0 |
| Put an app to sleep, or wake it | Shift-click its icon |

## Make it yours

Open **config.js** in Notepad (Monodesk makes it from `config.example.js` the first time it starts; updates never change it):
- `todoBoard`: link to your Notion to-do board (a database shown as a board). **New to-do** in the Ctrl K menu adds a card to it. Leave it `''` to hide that.
- `todoColumn`: which column New to-do adds to, for example `'Soon'`. Notion hides empty columns, so keep at least one card in it.
- `triagePrompt`: what **Run now** sends to Claude. If you have a Claude skill for this, name it here (for example `'Run my inbox triage'`).
- `elevenLabsKey`: your ElevenLabs API key, so Dispatch reads replies in an ElevenLabs voice (make one at elevenlabs.io → Developers → API Keys, with access to Text to Speech, Voices and User). It stays in this file on this PC. Monodesk makes the audio and only the audio goes to the phone. Leave it `''` to use the phone's own voice. `elevenLabsVoice` (a voice id) and `elevenLabsModel` are optional starting choices. `elevenLabsCollection` (default `'dispatch'`) names an ElevenLabs voice collection: when it exists, Dispatch lists only its voices. You pick both in Dispatch.

Save the file and Monodesk reloads by itself. Changes to the other files (style.css, renderer.js, main.js) also apply live while Monodesk is open, so you can ask Claude Code to change things and watch them happen.

## Updating

Click the **𝕸** in the top-left corner. It shows the version you're on and checks GitHub; when a newer one is out, the 𝕸 gets an orange dot and the menu has an **Update** button. Update downloads the new version (or runs `git pull` in a git checkout), keeps your `config.js` and sign-ins, and restarts Monodesk. Dispatch, if it's installed next to Monodesk, updates too.

**Publishing a new version** (for whoever maintains Monodesk): make the change, raise `version` in `package.json` (0.2.0 → 0.2.1), commit and push to `main`. Everyone's 𝕸 shows the update within six hours, or right away when they click it.

## Dispatch (Claude on your iPhone)

Monodesk runs a small server on `127.0.0.1:47800` for [Dispatch](https://github.com/TetonTopo/dispatch), a phone app for your recent Claude chats and Claude Code sessions. It uses Monodesk's Claude sign-in, so Monodesk has to be running on the PC.

1. Clone Dispatch next to this folder: in `Documents`, run `git clone https://github.com/TetonTopo/dispatch`. Monodesk looks for `..\dispatch`. To keep it somewhere else, set the `MONODESK_DISPATCH` environment variable to that folder.
2. Share the server on your tailnet: `tailscale serve --bg 47800`. Only devices signed in to your Tailscale can reach it.
3. On the iPhone, see the Dispatch README to add it to the home screen.

When Claude stops to ask a multiple-choice question (in Co-work or Claude Code), Dispatch shows the questions with their choices; your answers are entered on claude.ai by Monodesk, in a hidden window, exactly as if you'd clicked them.

Every reply read in an ElevenLabs voice is saved as an MP3 in `%APPDATA%\Monodesk\readings` (the newest 200, up to 1 GB), for Dispatch's **Saved** list. Hearing one again, there or from its thread, costs nothing, even after Monodesk restarts.

## Claude can use Monodesk (MCP)

`mcp/monodesk-mcp.js` is a small MCP server that lets Claude on this PC use Monodesk: read and send WhatsApp, and see and drive any tab (Gmail, Notion, Claude, WhatsApp, Google Calendar) like a browser. It works inside the apps that are already signed in, so nothing logs in anywhere new. Monodesk has to be running, with the app Claude needs awake.

**WhatsApp:**
- `whatsapp_list_chats`: the chats in WhatsApp's sidebar, with unread counts.
- `whatsapp_read_chat`: one chat's recent messages (time, sender, text). The name can be partial ("moat" finds "THE MOAT").
- `whatsapp_send_message`: sends a message to one chat, as you. The name has to match the chat exactly, so a partial name can never send to the wrong chat.

Reading or sending opens the chat in WhatsApp for a moment, like clicking it, so WhatsApp may mark it read. The chat you had open is opened again afterwards.

**Any tab:** `monodesk_tabs` lists the open tabs with an id each. With an id, Claude can `monodesk_read` the page's text, `monodesk_elements` to number its buttons, links and fields, then `monodesk_click` one, `monodesk_type` into one (real keystrokes, so Notion and WhatsApp take it), `monodesk_press` a key or shortcut, `monodesk_screenshot` the tab that's on screen, `monodesk_navigate` to a link on that tab's own site, or `monodesk_script` to run JavaScript in the page for anything else.

The tools that send, click, type or run scripts are marked as making changes, so Claude asks you before each one unless you've told it to always allow that tool. They act as you in your signed-in apps.

**WhatsApp into Notion:** ask Claude something like "copy the last day of THE MOAT into my Project notes page in Notion". It reads the chat here and writes the page with Claude's own Notion connector, which is faster and tidier than typing into the Notion tab.

Why not Playwright? Playwright can attach to Monodesk's Chromium, but it can't see Electron `<webview>` tabs, and every Monodesk app is one. These tools do the same job from inside Monodesk.

**Claude desktop app:** Settings → Developer → Edit Config, and add Monodesk to `mcpServers` (use your own folder path, with double backslashes):

```json
{
  "mcpServers": {
    "monodesk": {
      "command": "node",
      "args": ["C:\\Users\\dk\\Documents\\monodesk\\mcp\\monodesk-mcp.js"]
    }
  }
}
```

Restart the Claude app. **Claude Code:** `claude mcp add monodesk -- node "C:\Users\dk\Documents\monodesk\mcp\monodesk-mcp.js"`.

It needs no packages. Under the hood it calls the bridge's `/api/whatsapp/…` and `/api/agent/…` endpoints, which only answer requests that carry the `x-monodesk: 1` header, so a web page can't read or drive your apps. The bridge listens on this PC only (and on your tailnet if you share it for Dispatch), so anything you let reach port 47800 can use these too.

## Privacy

The folder holds only code. Your sign-ins, cookies, pinned chats and drafts live in `%APPDATA%\Monodesk` on your own computer and are never in the folder or the zip. Sharing the folder shares nothing personal. To sign everything out on a computer, quit Monodesk and delete `%APPDATA%\Monodesk`.

## If something's off

- **WhatsApp panel says loading:** open the WhatsApp tab once; it needs to finish syncing.
- **Mail panel is empty:** sign in to Gmail in the Mail tab.
- **A Home button stops working** after Gmail, WhatsApp or Notion changes their page: tell DK. These features read the real websites, so a redesign can need a small fix.
- **Start Monodesk.cmd flashes and nothing opens:** Node.js isn't installed, or the folder was moved. Reinstall Node, then run Start Monodesk.cmd again.
