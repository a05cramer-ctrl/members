// Sign for your share as a Discord server member.
// POST {coin, message, signature, token}: the wallet signs "MEMBERS sign", the browser passes the Discord login token it got
// from Discord, we check with Discord that this account was in the coin's server before the coin launched, then that Discord
// account and that wallet join the coin's members (one each per coin). Signing closes the moment the coin graduates.
import { redis, send, hobj, validateUser, memberOf, ownsGuild, hashUser } from './_lib.js';
import { graduated } from './_chain.js';
import { parseMsg, verifyWallet } from './_msg.js';
const ip = req => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
async function limit(key, max, sec) { const n = await redis('INCR', 'rl:' + key); if (n === 1) await redis('EXPIRE', 'rl:' + key, sec); if (n > max) throw new Error('too many tries, wait a bit'); }
const MIN_AGE = 30 * 24 * 3600 * 1000;
// 'kaiser' → 'ka•••r'
const mask = n => { const a = Array.from(String(n || '')); return a.length <= 3 ? (a[0] || '?') + '•••' : a.slice(0, 2).join('') + '•••' + a[a.length - 1]; };
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, {});
  if (req.method !== 'POST') return send(res, 405, { error: 'POST' });
  try {
    const b = req.body || {};
    await limit('ip:' + ip(req), 30, 3600);
    const f = parseMsg(b.message, 'MEMBERS sign'); verifyWallet(b.message, b.signature, f);
    const c = hobj(await redis('HGETALL', 'coin:' + f.coin)); if (!c.mint) throw new Error('not a MEMBERS coin');
    if (await graduated(f.coin)) throw new Error('this coin graduated, signing is closed');
    const u = await validateUser(b.token);
    if (!u.createdAt || Date.now() - u.createdAt < MIN_AGE) throw new Error('this Discord account is too new');
    const m = await memberOf(b.token, c.gid);
    if (!m) throw new Error(`${u.username} is not in ${c.server}`);
    if (!m.joinedAt || m.joinedAt >= Number(c.createdAt)) throw new Error(`you joined ${c.server} after this coin launched — only members from before launch count`);
    if (await ownsGuild(b.token, c.gid)) throw new Error("that's the server owner: the owner gets the creator fees, members get the coins");
    const h = hashUser(u.id);
    if (await redis('HEXISTS', 'tsig:' + f.coin, h)) throw new Error('this Discord account already signed for this coin');
    if (!(await redis('HSETNX', 'tsig:' + f.coin, h, f.wallet))) throw new Error('this Discord account already signed for this coin');
    if (!(await redis('HSETNX', 'wsig:' + f.coin, f.wallet, h))) { await redis('HDEL', 'tsig:' + f.coin, h); throw new Error('this wallet already signed for this coin'); }
    const name = mask(u.username), now = Date.now();
    await redis('SADD', 'wcoins:' + f.wallet, f.coin);
    await redis('RPUSH', 'signlog:' + f.coin, JSON.stringify({ name, joined: m.joinedAt, wallet: f.wallet, ts: now }));
    await redis('HINCRBY', 'stats', 'signers', 1);
    await redis('LPUSH', 'events', JSON.stringify({ k: 'member', mint: f.coin, symbol: c.symbol, server: c.server, name, joined: m.joinedAt, ts: now }));
    await redis('LTRIM', 'events', 0, 79);
    send(res, 200, { ok: true, name: u.username, joined: m.joinedAt, server: c.server });
  } catch (e) { send(res, 400, { error: e.message }); }
}
