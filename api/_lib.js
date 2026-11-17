// shared helpers for MEMBERS functions (files starting with _ are not routes on Vercel)
export const HELIUS = () => `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
export function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
}
export function send(res, code, body, cache) {
  cors(res);
  if (cache) res.setHeader('Cache-Control', cache);
  res.status(code).json(body);
}
export async function getJSON(url, opt) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, { ...opt, headers: { accept: 'application/json', 'user-agent': 'MEMBERS/1.0', ...(opt?.headers || {}) }, signal: AbortSignal.timeout(9000) });
    if (r.status === 429 && i < 2) { await new Promise(s => setTimeout(s, 700 * (i + 1))); continue; }
    if (!r.ok) { const e = new Error(`${r.status} ${url.split('?')[0]}`); e.status = r.status; throw e; }
    return r.json();
  }
}
export async function rpc(method, params) {
  const r = await fetch(HELIUS(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'rpc error');
  return j.result;
}
// any Vercel-connected Upstash store works, whatever prefix it was connected with (KV_, STORAGE_, …)
const envEnd = suf => process.env[Object.keys(process.env).find(k => k.endsWith(suf) && !k.includes('READ_ONLY'))];
const RURL = () => process.env.UPSTASH_REDIS_REST_URL || envEnd('_REST_API_URL');
const RTOK = () => process.env.UPSTASH_REDIS_REST_TOKEN || envEnd('_REST_API_TOKEN');
export const SITE = () => process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL : '');
// every key is namespaced so MEMBERS can share a Redis store with other projects safely
const P = c => c.length > 1 ? [c[0], 'mem:' + c[1], ...c.slice(2)] : c;
export async function redis(...cmd) {
  cmd = P(cmd);
  const r = await fetch(RURL(), { method: 'POST', headers: { Authorization: `Bearer ${RTOK()}`, 'content-type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
export async function pipeline(cmds) {
  if (!cmds.length) return [];
  const r = await fetch(RURL() + '/pipeline', { method: 'POST', headers: { Authorization: `Bearer ${RTOK()}`, 'content-type': 'application/json' }, body: JSON.stringify(cmds.map(P)) });
  return (await r.json()).map(x => x.result);
}
export const hobj = arr => { const o = {}; for (let i = 0; arr && i < arr.length; i += 2) o[arr[i]] = arr[i + 1]; return o; };
export const isMint = s => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s || '');


// ---------- Discord ----------
// No bot and no client secret: users log in with Discord's implicit grant (response_type=token,
// scopes identify guilds guilds.members.read) and the browser passes that token here.
import crypto from 'node:crypto';
const DAPI = 'https://discord.com/api/v10';
export const DISCORD_ID = () => process.env.DISCORD_CLIENT_ID || '';
export const hashUser = id => crypto.createHash('sha256').update('members|' + String(id)).digest('hex');
const snowTime = id => { try { return Number((BigInt(id) >> 22n) + 1420070400000n); } catch { return 0; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// GET a Discord API path (optionally with a user token). 404 → null; 429 → waits retry_after and retries.
async function dget(path, token) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(DAPI + path, { headers: { accept: 'application/json', 'user-agent': 'MEMBERS (https://discord.com, 1.0)', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, signal: AbortSignal.timeout(9000) });
    if (r.status === 429 && i < 2) {
      const j = await r.json().catch(() => ({}));
      const wait = Number(j.retry_after ?? r.headers.get('retry-after') ?? 1);
      if (wait > 8) { const e = new Error('Discord is rate limiting, try again in a few seconds'); e.status = 429; throw e; }
      await sleep(Math.max(250, wait * 1000)); continue;
    }
    if (r.status === 404) return null;
    if (!r.ok) { const e = new Error('Discord ' + r.status); e.status = r.status; throw e; }
    return r.json();
  }
  const e = new Error('Discord is rate limiting, try again in a few seconds'); e.status = 429; throw e;
}
// discord.gg/X, discord.com/invite/X, discordapp.com/invite/X or a bare code → code
export function inviteCode(s) {
  s = String(s || '').trim();
  const m = s.match(/(?:discord(?:app)?\.com\/invite|discord\.gg)\/([A-Za-z0-9-]{2,40})/i);
  const code = m ? m[1] : s.replace(/^https?:\/\//, '').replace(/[?#].*$/, '');
  return /^[A-Za-z0-9-]{2,40}$/.test(code) ? code : null;
}
const iconUrl = (id, hash) => hash ? `https://cdn.discordapp.com/icons/${id}/${hash}.png?size=256` : '';
const GUILD_TTL = 10 * 60 * 1000;
async function cacheGuild(g) {
  await redis('HSET', 'guild:' + g.id, 'id', g.id, 'name', g.name, 'icon', g.icon, 'banner', g.banner, 'description', g.description, 'members', String(g.members), 'online', String(g.online), 'invite', g.invite, 'ts', String(Date.now())).catch(() => null);
  return g;
}
const shapeCached = h => h && h.id ? { id: h.id, name: h.name, icon: h.icon || '', banner: h.banner || '', description: h.description || '', members: Number(h.members) || 0, online: Number(h.online) || 0, invite: h.invite || '', ts: Number(h.ts) || 0 } : null;
// an invite → its server: {id, name, icon, banner, description, members, online, invite}. Cached 10 min per server.
export async function resolveInvite(codeOrUrl) {
  const code = inviteCode(codeOrUrl);
  if (!code) { const e = new Error('paste a Discord invite link like discord.gg/yourserver'); e.status = 400; throw e; }
  const j = await dget(`/invites/${encodeURIComponent(code)}?with_counts=true&with_expiration=true`);
  if (!j) return null;
  const g = j.guild;
  if (!g || !g.id) { const e = new Error('that invite is not for a Discord server'); e.status = 400; throw e; }
  if (j.expires_at && Date.parse(j.expires_at) < Date.now()) { const e = new Error('that Discord invite has expired'); e.status = 400; throw e; }
  return cacheGuild({
    id: g.id, name: String(g.name || ''), icon: iconUrl(g.id, g.icon),
    banner: g.banner ? `https://cdn.discordapp.com/banners/${g.id}/${g.banner}.png?size=1024` : '',
    description: String(g.description || '').slice(0, 300),
    members: Number(j.approximate_member_count ?? j.profile?.member_count) || 0, online: Number(j.approximate_presence_count ?? j.profile?.online_count) || 0, invite: j.code || code,
  });
}
// a server we have seen before (via an invite); refreshed through its invite when older than 10 minutes
export async function guildById(id) {
  if (!/^\d{15,22}$/.test(String(id || ''))) return null;
  const c = shapeCached(hobj(await redis('HGETALL', 'guild:' + id)));
  if (c && Date.now() - c.ts > GUILD_TTL && c.invite) {
    const g = await resolveInvite(c.invite).catch(() => null);
    if (g && g.id === c.id) return g;
  }
  return c;
}
// check a user token the browser got from Discord: it must belong to our app and carry our scopes
export async function validateUser(token) {
  if (!token || !/^[A-Za-z0-9._-]{20,100}$/.test(String(token))) throw new Error('log in with Discord first');
  const r = await fetch(DAPI + '/oauth2/@me', { headers: { Authorization: 'Bearer ' + token, 'user-agent': 'MEMBERS (https://discord.com, 1.0)' }, signal: AbortSignal.timeout(8000) });
  if (r.status === 401) throw new Error('Discord login expired, log in again');
  if (r.status === 429) throw new Error('Discord is rate limiting, try again in a few seconds');
  if (!r.ok) throw new Error('Discord ' + r.status);
  const v = await r.json();
  if (!DISCORD_ID() || v.application?.id !== DISCORD_ID()) throw new Error('that Discord login is not from MEMBERS');
  if (v.expires && Date.parse(v.expires) < Date.now()) throw new Error('Discord login expired, log in again');
  const scopes = v.scopes || [];
  if (!['identify', 'guilds', 'guilds.members.read'].every(s => scopes.includes(s))) throw new Error('log in with Discord again and allow every permission it asks for');
  const u = v.user || {};
  if (!u.id) throw new Error('log in with Discord first');
  const avatar = u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128` : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(u.id) >> 22n) % 6n)}.png`;
  return { id: u.id, username: u.global_name || u.username, avatar, scopes, createdAt: snowTime(u.id) };
}
// is this user a member of this server? → {joinedAt (ms), nick, roles (count)} or null
export async function memberOf(token, guildId) {
  try {
    const j = await dget(`/users/@me/guilds/${encodeURIComponent(guildId)}/member`, token);
    if (!j) return null;
    return { joinedAt: Date.parse(j.joined_at) || 0, nick: j.nick || '', roles: (j.roles || []).length };
  } catch (e) {
    if (e.status === 403 || e.status === 404) return null;
    if (e.status === 401) throw new Error('Discord login expired, log in again');
    throw e;
  }
}
// does this user own this server?
export async function ownsGuild(token, guildId) {
  let list;
  try { list = await dget('/users/@me/guilds?with_counts=false', token); }
  catch (e) { if (e.status === 401) throw new Error('Discord login expired, log in again'); throw e; }
  return !!(list || []).find(g => g.id === String(guildId) && g.owner === true);
}
