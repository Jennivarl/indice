// Tiny JSON-file store. Good enough for an MVP; every payout also lives on-chain.
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.resolve(process.env.DATA_FILE || 'data/db.json');
const empty = { users: {}, reports: [], payouts: [], sales: [] };

export function load() {
  try { return { ...empty, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; }
  catch { return structuredClone(empty); }
}
export function save(db) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(db, null, 2));
  fs.renameSync(FILE + '.tmp', FILE);
}
