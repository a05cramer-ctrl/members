// GET ?invite= → the Discord server behind an invite (discord.gg/X, discord.com/invite/X or the bare code) + its MEMBERS coins
// GET ?id=     → a server we have seen before, by its id + its MEMBERS coins
import { redis, pipeline, send, hobj, resolveInvite, guildById } from './_lib.js';
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, {});
  try {
    const g = req.query.invite !== undefined ? await resolveInvite(req.query.invite) : await guildById(req.query.id);
    if (!g) return send(res, 404, { error: 'no Discord server for that invite' });
    const mints = (await redis('SMEMBERS', 'gcoins:' + g.id)) || [];
    const rows = mints.length ? await pipeline(mints.map(m => ['HGETALL', 'coin:' + m])) : [];
    const { ts, ...server } = g;
    send(res, 200, { ...server, coins: rows.map(hobj).filter(c => c.mint).map(c => ({ mint: c.mint, name: c.name, symbol: c.symbol, image: c.image, createdAt: Number(c.createdAt) })) }, 's-maxage=60');
  } catch (e) { send(res, e.status === 400 ? 400 : e.status === 429 ? 429 : 502, { error: e.message }); }
}
