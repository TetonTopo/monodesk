// The starting settings. On first run Monodesk copies this to config.js, which is yours: edit that one.
// Updates replace this file but never config.js.
// Sign-ins, pinned chats and drafts are not stored here. They stay in Windows, in %APPDATA%\Monodesk.
window.MONODESK_CONFIG = {
  // The + in the top bar adds a card to this Notion board, in the column named below.
  // Paste the link to your to-do board (a database shown as a board). Leave it '' to hide the +.
  todoBoard: '',
  todoColumn: 'Soon',

  // What "Run now" in the Inbox triage panel on Home sends to Claude.
  // If you have a Claude skill for inbox triage, name it here, e.g. 'Run my inbox triage'.
  triagePrompt: 'Triage my unread email: summarize what matters, then ask me yes or no on what to do with each one.',
};
