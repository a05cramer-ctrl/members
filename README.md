# MEMBERS

Launch a pump.fun coin for any Discord server. The launcher's whole dev buy goes to the server's members in the same transaction; members log in with Discord (only accounts that joined before launch count) and sign before graduation, then split it equally. Each coin's pump.fun creator is its own fee wallet, claimable only by the Discord account that owns the server.

- `api/` Vercel functions (Discord checks, launch verification, settle, claims, owner fees)
- `index.html` the site, `auth.html` the Discord login return page
- Env: `HELIUS_API_KEY`, `FILEBASE_IPFS_TOKEN`, `DISTRIBUTOR_SECRET`, `DISCORD_CLIENT_ID`, Upstash Redis (`*_REST_API_URL` / `*_REST_API_TOKEN`)
