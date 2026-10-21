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

  // Dispatch's speaker reads Claude's replies in an ElevenLabs voice when this has your ElevenLabs API key
  // (elevenlabs.io → Developers → API Keys; let it use Text to Speech, Voices and User). It stays on this PC:
  // the phone never sees it. Leave it '' to use the phone's own voice. Pick the voice and model in Dispatch.
  elevenLabsKey: '',
  // Optional: a voice id to start on, and the model ('eleven_flash_v2_5' = half the credits, 'eleven_multilingual_v2', 'eleven_v3').
  elevenLabsVoice: '',
  elevenLabsModel: 'eleven_flash_v2_5',
  // Dispatch lists only the voices in this ElevenLabs collection (My Voices → Collections), if it exists.
  elevenLabsCollection: 'dispatch',
};
