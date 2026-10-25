// Extracted from the stock MobileKeyboardLedMgr KeyMapUS on this device.
// These are LED slot indices, not scan codes. Multi-slot keys must move together.
const sourceRows = [
  'ESC:0 F1:1 F2:2 F3:3 F4:4 F5:5 F6:6 F7:7 F8:8 F9:9 F10:10 F11:11 F12:12 INSERT:13 SCRLK:14 DEL:15',
  'TILDE:21 ONE:22 TWO:23 THREE:24 FOUR:25 FIVE:26 SIX:27 SEVEN:28 EIGHT:29 NINE:30 ZERO:31 MINUS:32 EQUALS:33 BACKSPACE:35 HOME:36',
  'TAB:42 Q:44 W:45 E:46 R:47 T:48 Y:49 U:50 I:51 O:52 P:53 BRACKET_OPEN:54 BRACKET_CLOSE:55 BACKSLASH:56 PAGE_UP:57',
  'CAPS:63 A:65 S:66 D:67 F:68 G:69 H:70 J:71 K:72 L:73 SEMICOLON:74 QUOTE:75 ENTER:76,77 PAGE_DOWN:78',
  'SHIFT_LEFT:84,85,86 Z:87 X:88 C:89 V:90 B:91 N:92 M:93 COMMA:94 PERIOD:95 SLASH:96 SHIFT_RIGHT:97 ARROW_UP:98 END:99',
  'CTRL_LEFT:105 FN:107 WINDOWS:108 ALT_LEFT:109 SPACE:112 ALT_RIGHT:115 MENU:116 CTRL_RIGHT:117 ARROW_LEFT:118 ARROW_DOWN:119 ARROW_RIGHT:120',
];

const labels: Record<string, string> = {
  INSERT: 'Ins', SCRLK: 'ScrLk', DEL: 'Del', TILDE: '~', ONE: '1', TWO: '2', THREE: '3', FOUR: '4', FIVE: '5', SIX: '6', SEVEN: '7', EIGHT: '8', NINE: '9', ZERO: '0', MINUS: '-', EQUALS: '=', BACKSPACE: 'Back', HOME: 'Home', TAB: 'Tab', BRACKET_OPEN: '[', BRACKET_CLOSE: ']', BACKSLASH: '\\', PAGE_UP: 'PgUp', CAPS: 'Caps', SEMICOLON: ';', QUOTE: "'", ENTER: 'Enter', PAGE_DOWN: 'PgDn', SHIFT_LEFT: 'Shift', SHIFT_RIGHT: 'Shift', ARROW_UP: '↑', END: 'End', CTRL_LEFT: 'Ctrl', WINDOWS: 'Win', ALT_LEFT: 'Alt', SPACE: 'Space', ALT_RIGHT: 'Alt', MENU: 'Menu', CTRL_RIGHT: 'Ctrl', ARROW_LEFT: '←', ARROW_DOWN: '↓', ARROW_RIGHT: '→', SLASH: '/', COMMA: ',', PERIOD: '.',
};

export type KeyboardLedKey = { id: string; label: string; indices: number[] };
export const keyboardUsRows: KeyboardLedKey[][] = sourceRows.map((row) => row.split(' ').map((entry) => {
  const [id, rawIndices] = entry.split(':');
  return { id, label: labels[id] ?? id, indices: rawIndices.split(',').map(Number) };
}));
