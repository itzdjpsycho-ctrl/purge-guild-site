# Purge Sign-Ups Worker

A tiny Cloudflare Worker that lets the website's **Sign Ups** page post a sign-up
sheet to Discord **as the bot** — so posting works from anyone's computer, even
when the bot PC is off. It holds the bot token as a secret (never in the website).

```
Website signups.html ──POST /post──► Worker ──► Discord (#channel)
Website signups.html ◄─GET /state──  Worker ◄── Bot pushes live state + channel
```

## One-time setup

1. **Make a Cloudflare account** (free): https://dash.cloudflare.com/sign-up
2. Install the CLI and log in (run these in this `worker/` folder):
   ```
   npm install
   npx wrangler login
   ```
3. **Create the KV store** and paste its id into `wrangler.toml` (replace
   `REPLACE_WITH_KV_NAMESPACE_ID`):
   ```
   npx wrangler kv namespace create SIGNUPS_KV
   ```
4. **Set the three secrets** (it prompts you to paste each value):
   ```
   npx wrangler secret put DISCORD_BOT_TOKEN     # same value as the bot's DISCORD_TOKEN
   npx wrangler secret put ADMIN_POST_PASSWORD   # a shared password admins type on the site
   npx wrangler secret put BOT_PUSH_SECRET        # any long random string
   ```
5. **Deploy:**
   ```
   npx wrangler deploy
   ```
   It prints your Worker URL, e.g. `https://purge-signups.<you>.workers.dev`.

## Wire it up

- **Website:** put that Worker URL into `WORKER_URL` near the top of `signups.html`,
  then push the site.
- **Bot:** in `bot/.env` set `WORKER_URL=<that url>` and `BOT_PUSH_SECRET=<same
  value you set above>`, then restart the bot (`npm start`).
- **Discord:** an admin runs `/signup channel set #your-channel` once. That tells
  the Worker where to post.

That's it. On the Sign Ups page, build the sheet and click **Post to Discord** —
you'll be asked for the admin password the first time (it's remembered after).

## Local testing

Copy `.dev.vars.example` → `.dev.vars`, fill in the three values, then:
```
npx wrangler dev
```
This serves the Worker at `http://localhost:8787`. Point `WORKER_URL` at that for
testing.
