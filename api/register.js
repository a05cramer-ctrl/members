// List a coin after launch: checks on-chain that the launcher's whole first buy reached the members' escrow, then stores it.
import { redis, pipeline, send, isMint, resolveInvite } from './_lib.js';
import { checkLaunch } from './_chain.js';
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, {});
  if (req.method !== 'POST') return send(res, 405, { error: 'POST' });
  try {
    const { sig, mint, gid, invite, image, name, symbol, sol } = req.body || {};
    if (!isMint(mint) || !sig) throw new Error('mint and sig required');
    if (!/^\d{15,22}$/.test(String(gid || ''))) throw new Error('Discord server id required');
    if (await redis('EXISTS', 'coin:' + mint)) return send(res, 200, { ok: true, existing: true });
    const g = await resolveInvite(invite); if (!g) throw new Error('no Discord server for that invite');
    if (g.id !== String(gid)) throw new Error('that invite is for a different Discord server');
    const { amount, creator } = await checkLaunch(sig, mint, g.id);
    const sym = String(symbol).slice(0, 10), now = Date.now();
    await pipeline([
      ['HSET', 'coin:' + mint, 'mint', mint, 'sig', sig, 'name', String(name).slice(0, 32), 'symbol', sym, 'image', image || '', 'gid', g.id, 'server', g.name, 'icon', g.icon || '', 'invite', g.invite, 'members', String(g.members), 'total', amount.toString(), 'sol', String(Number(sol) || 0), 'createdAt', now, 'creator', creator],
      ['LPUSH', 'coins', mint],
      ['SADD', 'servers', g.id],
      ['SADD', 'gcoins:' + g.id, mint],
      ['HINCRBYFLOAT', 'stats', 'sol', String(Number(sol) || 0)],
      ['LPUSH', 'events', JSON.stringify({ k: 'launch', mint, symbol: sym, server: g.name, icon: g.icon || '', members: g.members, sol: Number(sol) || 0, ts: now })],
      ['LTRIM', 'events', 0, 79],
    ]);
    send(res, 200, { ok: true, total: amount.toString() });
  } catch (e) { send(res, 400, { error: e.message }); }
}
