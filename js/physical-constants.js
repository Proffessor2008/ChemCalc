export const FARADAY = 96485.33212;
export const GAS_CONSTANT = 8.314462618;

export function nernst(E0Value, electronsValue, qValue, temperatureValue = 298.15) {
  const E0 = Number(E0Value);
  const electrons = Number(electronsValue);
  const q = Number(qValue);
  const temperature = Number(temperatureValue);
  if (!Number.isFinite(E0) || !Number.isInteger(electrons) || electrons < 1 || !Number.isFinite(q) || q <= 0 || !Number.isFinite(temperature) || temperature <= 0) throw new RangeError('Проверьте E°, n, Q > 0 и T > 0 K');
  const E = E0 - GAS_CONSTANT * temperature / (electrons * FARADAY) * Math.log(q);
  return { E, steps: [`E = E° − RT/(nF) · ln Q = ${E0} − (${GAS_CONSTANT}·${temperature}) / (${electrons}·${FARADAY}) · ln(${q}) = ${E.toFixed(6)} В.`] };
}
