// Small ANSI console-styling helpers for the bot's terminal window — purely
// cosmetic (mirrors the site's neon-purple theme from the website's
// CLAUDE.md), never changes what's logged, just how it looks. Falls back to
// plain, uncolored text when stdout isn't a real TTY (piped to a file,
// NO_COLOR set) so logs stay grep-able either way.
const supportsColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

function paint(code, s) {
  return supportsColor ? `\x1b[${code}m${s}\x1b[0m` : s;
}

export const purple = (s) => paint("38;2;171;77;255", s); // #AB4DFF — UI accent
export const gold = (s) => paint("38;2;232;188;85", s); // #E8BC55 — highlight
export const green = (s) => paint("38;2;91;201;118", s); // #5BC976 — success
export const red = (s) => paint("38;2;214;90;69", s); // #D65A45 — failure
export const dim = (s) => paint("2", s);
export const bold = (s) => paint("1", s);

/** Boxed title banner, printed once when the bot logs in. */
export function banner(title, subtitle) {
  const width = Math.max(title.length, subtitle ? subtitle.length : 0) + 2;
  const bar = "─".repeat(width);
  console.log(purple(`┌─${bar}─┐`));
  console.log(`${purple("│")} ${bold(purple(title.padEnd(width)))} ${purple("│")}`);
  if (subtitle) console.log(`${purple("│")} ${dim(subtitle.padEnd(width))} ${purple("│")}`);
  console.log(purple(`└─${bar}─┘`));
}

export const ok = (msg) => console.log(`${green("✓")} ${msg}`);
export const warn = (msg) => console.log(`${gold("⚠")} ${msg}`);
export const fail = (msg) => console.log(`${red("✗")} ${msg}`);
export const info = (msg) => console.log(`${dim("·")} ${msg}`);
