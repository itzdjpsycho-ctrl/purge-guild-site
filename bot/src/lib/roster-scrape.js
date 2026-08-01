import { chromium } from "playwright";
import { GUILD_PROFILE_URL } from "../config.js";

/**
 * Scrape the official Pearl Abyss guild profile page for the current member
 * list. The page is a JS-rendered SPA behind Incapsula bot-protection, so a
 * plain HTTP fetch won't see the roster — a real headless browser is
 * required (Incapsula's challenge passes for genuine browser traffic).
 *
 * @returns {Promise<{members:string[], guildMaster:string|null}>}
 */
export async function fetchOfficialRoster() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    });
    await page.goto(GUILD_PROFILE_URL, { waitUntil: "networkidle", timeout: 30_000 });

    // The page has no stable CSS hooks worth relying on (SPA, class names are
    // hashed), but the rendered text is a clean, predictable list: a "Family
    // Name" column header, then one family name per line — the Guild Master's
    // name is immediately followed by a "Guild Master" line — until the page
    // footer (social links) starts.
    const { members, guildMaster } = await page.evaluate(() => {
      const lines = document.body.innerText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

      const startIdx = lines.lastIndexOf("Family Name");
      const rest = startIdx === -1 ? lines : lines.slice(startIdx + 1);

      const names = [];
      let gm = null;
      for (const line of rest) {
        if (line === "Guild Master") {
          gm = names[names.length - 1] || gm;
          continue;
        }
        // A real family name: alnum/underscore only, no spaces. The footer
        // (social links, legal text, language list) breaks this pattern, so
        // hitting a non-matching line ends the roster.
        if (/^[A-Za-z0-9_]{2,20}$/.test(line)) names.push(line);
        else break;
      }
      return { members: names, guildMaster: gm };
    });

    if (!members.length) {
      throw new Error("Parsed 0 members — the guild page's markup may have changed.");
    }
    return { members: [...new Set(members)].sort((a, b) => a.localeCompare(b)), guildMaster };
  } finally {
    await browser.close();
  }
}
