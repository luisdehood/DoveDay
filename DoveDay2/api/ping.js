export default async function handler(req, res) {
  // simula un pequeño trabajo
  await new Promise(r => setTimeout(r, 80));
  res.status(200).json({ ok: true, ts: Date.now() });
}