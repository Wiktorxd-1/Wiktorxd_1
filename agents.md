# Wiktorxd Bot — Developer & Agent Guide (agents.md)

> This document is the definitive single-source-of-truth for AI coding agents and human developers working on this codebase. It provides complete architectural context, API mappings, command specifications, database schemas, and operational instructions so you do not need to re-read or scan the entire repository.

---

## 1. Core Architecture & Tech Stack

- **Runtime**: Node.js (v22+ LTS in production, v26 compatible)
- **Library**: `discord.js` v14.27.0
- **Auxiliary Bot Engine**: `discord.js-selfbot-v13` v3.7.1 (for developer message monitoring and presence metadata)
- **Database**: MySQL (via `mysql2/promise` connection pooling) + Local JSON/NDJSON persistence in `Data/`
- **Networking**: `undici` connection pooling with persistent keepalive agent, `axios` with keepalive, and `node:dns` (`ipv4first`)
- **Process & Security**: AST recursive-descent math parser (zero `eval`/`new Function`), strict `execFileSync`/`execFile` parameter vectors, `-threads 2` CPU capping
- **HTTP Microservices**: Hatches API running an embedded HTTP server on port `50006`

---

## 2. Strict Rules & Constraints (Non-Negotiable)

1. **ABSOLUTELY NO COMMENTS IN CODE FILES**:
   - The user has a strict constraint: **NO COMMENTS in code files (`//` or `/* */`)**.
   - Do **NOT** add single-line comments (`// ...`) or block comments (`/* ... */`) to any `.js` file.
   - Any documentation or explanation belongs in this `agents.md` file, git commit messages, or chat responses.

2. **Commit Message Conventions**:
   - Every commit message must strictly follow standard open-source **Conventional Commits** format:
     - `feat: ...`, `fix: ...`, `refactor: ...`, `perf: ...`, `style: ...`, `build: ...`, `chore: ...`
   - Use concise imperative mood ("add", "resolve", "optimize", "streamline").
   - Never use AI-sounding phrases or informal notes.
   - **Never mention API keys, tokens, or secrets in commit messages or code**.

3. **Secret Hygiene**:
   - Never commit API keys, bot tokens, database passwords, or webhook secrets.
   - All secrets must resolve dynamically via `process.env.*`.
   - Before completing tasks, always run `npm test` (`node tests/audit_secrets.js`).

4. **Resource & Latency Rules**:
   - Multi-threading processes (like `ffmpeg`, `spotdl`) must be capped at 2 threads (`-threads 2`, `--threads 2`).
   - Downloads must stream directly to disk (`res.data.pipe(writeStream)`) rather than buffering hundreds of megabytes in memory.
   - Faststart MP4 atom (`-movflags +faststart`) is required for inline Discord media playback.
   - Rate limiters apply a sliding window of 3 requests per 10 seconds per user (except bot owner).
   - Temporary file assets in `Data/` must be swept periodically (files older than 30 minutes are purged every 5 minutes).

---

## 3. Repository Directory Structure

```text
Wiktorxd_1/
├── index.js                  # Main bot entry point, Discord client, event dispatchers, background task bootstrap
├── package.json              # Project dependencies, scripts, overrides
├── agents.md                 # Complete agent context and architecture reference (this file)
├── README.md                 # General project introduction
├── .gitignore                # Ignored assets: .env, node_modules, temp files
├── Commands/                 # 37 Slash and Prefix command definitions
├── Utility/                  # Modular services, background watchers, API servers, rate limiting
│   ├── Hatches/              # Hatches subsystem (secrets tracking, member monitoring, preferences)
├── Data/                     # Local persistence, caches, and state files
│   ├── Hatches/              # Hatches-specific user settings
│   ├── IDs/                  # Message ID state tracking
│   ├── Images/               # Static assets and overlays for canvas generation
│   └── Old/                  # Deprecated / legacy scripts for reference
└── tests/                    # Automated security audit and secret leak test suites
```

---

## 4. Production Deployment & Server Environment

- **Production Host**: `wiktor@node.wiktorxd-1.dev`
- **SSH Port**: `2222` (Always use `-p 2222` when connecting via SSH)
- **Container Name**: `78b8b0e1-b6a7-4ba9-92ba-f4cc6451ae80` (Container ID prefix: `6a27f2eb8008`)
- **Container Working Directory**: `/home/container`
- **Main Microservice Port**: Port `50006` mapped `0.0.0.0:50006 -> 50006/tcp`

### Standard Deployment Workflow
When updating the live production bot:
```bash
# 1. Commit and push changes to GitHub
git add .
git commit -m "feat/fix/perf: <conventional message>"
git push origin main

# 2. SSH into host, fetch and reset container to origin/main
ssh -p 2222 wiktor@node.wiktorxd-1.dev "docker exec 78b8b0e1-b6a7-4ba9-92ba-f4cc6451ae80 bash -c 'git fetch origin && git reset --hard origin/main'"

# 3. Restart the container
ssh -p 2222 wiktor@node.wiktorxd-1.dev "docker restart 78b8b0e1-b6a7-4ba9-92ba-f4cc6451ae80"

# 4. Verify startup logs
ssh -p 2222 wiktor@node.wiktorxd-1.dev "docker logs --tail 30 78b8b0e1-b6a7-4ba9-92ba-f4cc6451ae80"
```

---

## 5. Main Bot Architecture (`index.js`)

1. **Networking Optimization**:
   - `dns.setDefaultResultOrder('ipv4first')` eliminates dual-stack IPv6 fallback delays.
   - `undici.Agent` persistent HTTP connection pooling with `keepAliveTimeout: 60000`, `connections: 50`, `pipelining: 1`, and `noDelay: true`.
   - `rest.offset: 0` eliminates the artificial 50ms rate limit scheduling buffer in `discord.js`.
   - `client.rest.get('/gateway')` warms the TLS socket upon `clientReady` to prevent cold-connection penalties on the first interaction.
   - All immediate commands (`dice`, `8ball`, `gaydar`, `stats`) respond in a single phase without artificial sleeps or unnecessary `deferReply` round trips.

2. **Intent Pruning (High Performance)**:
   - Uses only 6 essential gateway intents:
     - `Guilds`, `GuildMembers`, `GuildPresences`, `GuildMessages`, `DirectMessages`, `MessageContent`.
   - 11 unused intents (`GuildModeration`, `GuildVoiceStates`, `GuildScheduledEvents`, `AutoModeration*`, `GuildMessageReactions`, etc.) are explicitly omitted to prevent event loop saturation.

3. **Cache Sweeping**:
   - `sweepers.messages` purges stale messages every 300 seconds (lifetime 60s) to keep memory usage minimal and prevent garbage collection spikes.

4. **Event Routing**:
   - `interactionCreate`: Validates rate limits via `checkRateLimit(user.id)`, routes chat input commands from `client.commands`, and routes select menus (`handleDailyPerkInteraction`).
   - `messageCreate`: Enforces bot prefix (`?` or `process.env.PREFIX`), validates rate limits, and routes commands from `client.prefixCommands`.

---

## 6. Background Services & Utility Catalog (`Utility/`)

| File | Purpose & Functions | Event Hooks & Operations |
|---|---|---|
| `Utility/storage_cleaner.js` | Sweeps temporary files older than 30 minutes in `Data/`. | Runs every 5 minutes. Exports `startTempCleaner()`. |
| `Utility/rate_limiter.js` | In-memory sliding-window rate limiter (3 requests per 10s per user). | Exports `checkRateLimit(userId)`. Bypasses `BOT_OWNER_ID`. |
| `Utility/uptime.js` | Computes system uptime and rotates rich presence every 20s. | Exports `startUptimeUpdater(client, getStartTime)`. |
| `Utility/selfbot.js` | Boots `discord.js-selfbot-v13` using `DISCORD_SCRAPE_TOKEN`. | Exports `startSelfbot(mainClient)`, `selfbot`. |
| `Utility/dev_msgs.js` | Monitors developer messages from configured user IDs across designated channels. | Listens to `selfbot.on('messageCreate')` and handles startup catch-ups. |
| `Utility/hatches_api.js` | Embedded HTTP API server running on port `50006`. | Serves `/hatches`, `/bounties`, `/inf_egg`, `/status`, and `/ping`. Uses MySQL pool. |
| `Utility/daily_perks.js` | Posts daily Big Games perk announcements at UTC midnight. | Handles interaction select menus and daily schedule timers. |
| `Utility/auto_role.js` | Automatically assigns roles to new server members. | Listens to `client.on('guildMemberAdd')`. Target guild: `1426166275440382055`. |
| `Utility/events.js` | Periodically monitors game events from Big Games API. | Polls schedule every 5 minutes. |
| `Utility/updates.js` | Tracks game update logs, diffs changes, and posts notification embeds. | Polls every 30-60 seconds. |
| `Utility/reminders.js` | Manages scheduled user reminder queues. | Persists reminder timers in `Data/reminders.json`. |
| `Utility/deploy-commands.js`| Registers slash commands with the Discord REST API. | Triggered via `npm run deploy` or `DEPLOY_COMMANDS=true`. |
| `Utility/Hatches/secrets.js`| Core tracker for Pet Simulator / BGS Infinity hatched secrets. | Listens on selfbot, queries RoVer API, writes to `secrets.ndjson` and MySQL table `secrets`. |
| `Utility/Hatches/on_member.js`| Tracks user username/display name changes to update database records. | Listens to `client.on('guildMemberUpdate')`. |
| `Utility/Hatches/preference.js`| Manages user notification preferences for hatch alerts. | Persists preferences in `Data/Hatches/prefered.json`. |
| `Utility/Hatches/dm_support.js`| Dispatches direct messages for hatch alerts based on user subscriptions. | Formats and delivers embeds. |

---

## 7. Command Catalog (`Commands/`)

All commands export `data` (SlashCommandBuilder) and/or `prefixData` with an `async execute(interaction/message, ...)` method.

### Media & Utility
- **`download.js`**: High-performance multi-platform media downloader.
  - Supports: YouTube, TikTok, Instagram, Twitter/X, Bluesky, Reddit, Spotify (via spotdl), and direct CDN MP4 links.
  - Architecture: Streams directly to disk (`res.data.pipe`), converts with `-threads 2 -movflags +faststart` for instant inline Discord embedding, parses oEmbed and OpenGraph metadata, resolves missing artist/title fields.
- **`ping.js`**: High-speed latency diagnostics.
  - Uses background keepalive polling for Google and 1.1.1.1 with persistent `https.Agent` connection pooling. Measures real execution latency with sub-25ms race window fallback. Responds in a single phase without unnecessary edit round-trips.
- **`profile.js`**: Enriched Discord & Roblox profile embed v2.0.
  - Fetches Discord user badges, banners, nitro/avatar decorations, live presence activities (Rich Presence, Spotify tracks, custom status), and queries linked Roblox profile info via RoVer API.
- **`search.js`**: Multi-provider web search engine.
  - Hierarchical provider resolution: Google Custom Search API -> DuckDuckGo Lite scraping -> Wikipedia API fallback.
- **`math.js`**: Pure mathematical expression parser.
  - Evaluates arithmetic, trigonometric functions, exponents, and constants using recursive-descent tokenization. Fully sandboxed (zero `eval`/`Function`).
- **`dice.js`**: Complex dice expression evaluator.
  - Parses dice notation (e.g. `2d20 + 5`) via AST tokenization. Instant single-phase reply without artificial sleeps.
- **`translate.js`**: Text translation utility utilizing `google-translate-api-x` with ISO language code mapping.
- **`shorten.js`**: URL shortening client utilizing custom URL shortener endpoints.
- **`speechify.js`**: Canvas-based speech bubble meme overlay generator.
- **`stats.js`**: Bot process diagnostics (memory RSS/heap, process uptime, commit count via GitHub API, OS load).
  - Uses background rolling CPU usage tracker (0ms sampling latency) and direct reply.
- **`remindme.js`**: Sets persistent user reminders with human-readable time strings (`10m`, `2h`, `1d`).

### Moderation & Server Management
- **`clear.js`**: Bulk message purger with filters (user, bots, pins, embeds, attachments).
- **`ban.js` / `unban.js`**: Guild ban management with audit logging and optional message purge days.
- **`mute.js` / `unmute.js`**: Guild timeout management (duration parsing via `ms`).
- **`logs.js`**: Channel logging configuration and audit tracking.
- **`server_settings.js`**: Manages guild-specific configuration stored in `Data/server_settings.json`.
- **`preferences.js`**: User-level bot preferences and hatch notification subscriptions.

### Hatches & Game Tracking
- **`hatches.js`**: Interactive paginated UI to browse tracked secret pet hatches from the MySQL database.
- **`fixhatches.js`**: Admin diagnostic utility to repair corrupted or missing RoVer mappings in historical hatch data.
- **`addhatchping.js` / `turnoffping.js`**: Toggles user notification subscriptions for specific secret pets.

### Entertainment & Social
- **`avatar.js` / `pfp.js`**: Displays high-resolution server or global user avatar.
- **`membercount.js`**: Displays total member breakdown (humans vs bots).
- **`8ball.js`**: Magic 8-ball response generator with instant single-phase reply (zero artificial delay).
- **`gaydar.js`**: Entertainment rating generator with instant single-phase reply (zero deferral delay).
- **`timediff.js`**: Computes relative time differences between timezones.
- **`test.js`**: Quick diagnostic ping to verify slash command registration.
- **`restart.js` / `reload.js`**: Owner-only commands to reload modules or restart the process.

---

## 8. Data Storage & Schemas

### MySQL Database (`secrets` Table)
Used by `Utility/Hatches/secrets.js` and `Utility/hatches_api.js`:
```sql
CREATE TABLE IF NOT EXISTS secrets (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255),
    hatchedBy VARCHAR(255),
    discordUserId VARCHAR(64),
    chance VARCHAR(64),
    date DATETIME,
    channelIndex INT,
    INDEX idx_hatchedBy (hatchedBy),
    INDEX idx_discordUserId (discordUserId),
    INDEX idx_date (date)
);
```

### File-Based Persistence (`Data/`)
- `Data/secrets.ndjson`: Append-only newline-delimited JSON backup of all hatch events.
- `Data/messages.json`: Array of processed developer message snowflakes to prevent duplicate notifications.
- `Data/bounties.json`: Cached current Big Games bounties schedule (refreshed every 10m and at UTC midnight).
- `Data/updates.txt` & `Data/last_event_data.json`: State trackers for update monitor and event diffing.
- `Data/reminders.json`: Active scheduled reminder objects.
- `Data/Hatches/prefered.json`: User notification preference mappings.

---

## 9. Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `DISCORD_TOKEN` | Yes | Discord Bot token for the main client. |
| `DISCORD_CLIENT_ID` / `CLIENT_ID` | Yes | Application ID for registering Slash Commands. |
| `BOT_OWNER_ID` | Yes | Discord User ID of the bot owner (bypasses rate limits, grants admin commands). |
| `PREFIX` | No | Command prefix for non-slash messages (Default: `?`). |
| `DISCORD_SCRAPE_TOKEN` | Optional | Selfbot user token used for developer message and presence scraping. |
| `ROVER_API_KEY` | Optional | RoVer API key for resolving Roblox profiles and usernames from Discord IDs. |
| `ROBLOSECURITY` | Optional | Cookie for accessing authenticated Roblox web endpoints. |
| `DB_HOST` | Yes | MySQL server hostname / IP address. |
| `DB_PORT` | No | MySQL port (Default: `3306`). |
| `DB_USER` | Yes | MySQL database username. |
| `DB_PASSWORD` | Yes | MySQL database password. |
| `DB_DATABASE` | Yes | MySQL database name. |
| `SERVER_PORT` | No | Port for the Hatches API HTTP server (Default: `50006`). |
| `GOOGLE_API_KEY` / `GOOGLE_SEARCH_API_KEY` | Optional | Google Custom Search API key. |
| `GOOGLE_CSE_ID` / `GOOGLE_CX` | Optional | Google Custom Search Engine ID. |
| `GITHUB_TOKEN` | Optional | GitHub personal access token for commit stats without rate limits. |
| `DEPLOY_COMMANDS` | Optional | Set to `'true'` to auto-deploy slash commands on startup. |
| `INSTAGRAM_SESSION_ID` | Optional | Session cookie to scrape Instagram media without auth blocks. |
| `REDDIT_COOKIE` | Optional | Cookie for Reddit media ingestion. |
| `SHORTEN_API_KEY` & `SHORTEN_API_URL` | Optional | Endpoints for custom URL shortener service. |

---

## 10. Testing & Verification

Before finalizing any changes or pushing commits:
```bash
# 1. Run the automated secret and token audit
npm test

# 2. Verify zero syntax errors across the entire codebase
node -e "
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
function walk(dir) {
  let res = [];
  for (const f of fs.readdirSync(dir)) {
    if (f === 'node_modules' || f === '.git' || f === 'tests') continue;
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) res.push(...walk(p));
    else if (f.endsWith('.js')) res.push(p);
  }
  return res;
}
walk('.').forEach(f => execSync('node --check ' + f));
console.log('All files passed syntax check.');
"

# 3. Verify ZERO comments exist in code files
node -e "
const fs = require('fs');
const path = require('path');
function walk(dir) {
  let res = [];
  for (const f of fs.readdirSync(dir)) {
    if (f === 'node_modules' || f === '.git' || f === 'tests') continue;
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) res.push(...walk(p));
    else if (f.endsWith('.js')) res.push(p);
  }
  return res;
}
let hasComments = false;
for (const f of walk('.')) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((l, idx) => {
    const t = l.trim();
    if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) {
      console.error('Comment found:', f, idx + 1, t);
      hasComments = true;
    }
  });
}
if (!hasComments) console.log('Clean: Zero comments found.');
"
```
