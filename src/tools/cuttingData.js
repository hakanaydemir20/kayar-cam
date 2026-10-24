// Kesme verisi hesapları. Bütün sonuçlar makine/takım limitleriyle sınırlanır,
// sınırlandırma yapıldıysa uyarı döner.

export function rpmFromVc(vc, dia) {
  if (!(dia > 0)) return Infinity;
  return (vc * 1000) / (Math.PI * dia);
}

export function vcFromRpm(rpm, dia) {
  return (Math.PI * dia * rpm) / 1000;
}

/** Tahrikli/döner takım için devir ve dakikada ilerleme */
export function millingData(tool, maxRpm) {
  const warnings = [];
  let rpm = Math.round(rpmFromVc(tool.vc, tool.dia));
  if (rpm > maxRpm) {
    warnings.push(`${tool.name}: hesaplanan devir ${rpm} > limit ${maxRpm}, ${maxRpm} ile sınırlandı`);
    rpm = maxRpm;
  }
  const feed = round1(tool.fz * (tool.flutes || 1) * rpm); // mm/dak
  return { rpm, feed, warnings };
}

/** Ana iş milinde sabit takımla delme (iş mili döner): devir parça/takım çapından */
export function drillOnSpindle(tool, maxRpm) {
  const warnings = [];
  let rpm = Math.round(rpmFromVc(tool.vc, tool.dia));
  if (rpm > maxRpm) {
    warnings.push(`${tool.name}: devir ${rpm} > ${maxRpm}, sınırlandı`);
    rpm = maxRpm;
  }
  return { rpm, feedRev: tool.feed, warnings };
}

/** Kılavuz: ilerleme = hatve (mm/dev) */
export function tapData(tool, maxRpm) {
  const r = drillOnSpindle(tool, maxRpm);
  return { rpm: r.rpm, feedRev: tool.pitch, warnings: r.warnings };
}

/** Tornalama: G96 sabit kesme hızı + G50 devir limiti */
export function turningData(tool, minDia, machineMax) {
  const need = Math.round(rpmFromVc(tool.vc, Math.max(minDia, 0.5)));
  const limit = Math.min(machineMax, need > 0 ? machineMax : machineMax);
  return { vc: tool.vc, maxRpm: limit, feedRev: tool.feed, warnings: [] };
}

export function round1(v) { return Math.round(v * 10) / 10; }
export function round3(v) { return Math.round(v * 1000) / 1000; }

// ISO metrik diş tablosu (kaba hatve) — diş derinliği h = 0.6134 * P (dış diş, çap üzerinden 2h)
export const METRIC_COARSE = {
  1.6: 0.35, 2: 0.4, 2.5: 0.45, 3: 0.5, 4: 0.7, 5: 0.8, 6: 1.0, 8: 1.25, 10: 1.5, 12: 1.75, 14: 2.0, 16: 2.0, 18: 2.5, 20: 2.5,
};
export function threadDepth(pitch) { return round3(0.6134 * pitch); }
export function tapDrillDia(nominal, pitch) { return round3(nominal - pitch); }
