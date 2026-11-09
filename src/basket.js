// The basket Indice tracks: everyday staples Argentines buy every week.
// Weights are shares of the basket (sum = 1). Aliases let people report in plain Spanish.
export const BASKET = [
  { id: 'pan',      name: 'Pan francés (1 kg)',          weight: 0.12, aliases: ['pan', 'pan frances', 'pan francés'] },
  { id: 'leche',    name: 'Leche entera (1 L)',          weight: 0.12, aliases: ['leche'] },
  { id: 'carne',    name: 'Carne picada común (1 kg)',   weight: 0.16, aliases: ['carne', 'carne picada', 'picada'] },
  { id: 'huevos',   name: 'Huevos (docena)',             weight: 0.08, aliases: ['huevos', 'huevo', 'docena'] },
  { id: 'yerba',    name: 'Yerba mate (1 kg)',           weight: 0.10, aliases: ['yerba', 'yerba mate'] },
  { id: 'arroz',    name: 'Arroz (1 kg)',                weight: 0.07, aliases: ['arroz'] },
  { id: 'fideos',   name: 'Fideos secos (500 g)',        weight: 0.07, aliases: ['fideos', 'fideo', 'pasta'] },
  { id: 'aceite',   name: 'Aceite de girasol (1,5 L)',   weight: 0.09, aliases: ['aceite', 'aceite girasol'] },
  { id: 'azucar',   name: 'Azúcar (1 kg)',               weight: 0.06, aliases: ['azucar', 'azúcar'] },
  { id: 'papa',     name: 'Papa (1 kg)',                 weight: 0.06, aliases: ['papa', 'papas'] },
  { id: 'colectivo',name: 'Boleto de colectivo (mínimo)',weight: 0.07, aliases: ['colectivo', 'bondi', 'boleto'] },
];

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

export function findProduct(text) {
  const t = norm(text);
  // longest alias first so "carne picada" beats "carne"
  const all = BASKET.flatMap((p) => p.aliases.map((a) => ({ p, a: norm(a) }))).sort((x, y) => y.a.length - x.a.length);
  return all.find(({ a }) => t === a || t.startsWith(a + ' ') || t.startsWith(a))?.p || null;
}

export const byId = Object.fromEntries(BASKET.map((p) => [p.id, p]));
