// infra/k6/scripts/lib/stages.js
//
// Shared ramp-profile builder: ramp up → sustain the peak → ramp down, per AC-70
// ("ramps concurrency toward the PROPOSED target ... and sustains the peak for a
// defined window"). Every scenario script overrides the target VUs and the three
// stage durations via env vars (see each script's header + infra/k6/README.md), all
// defaulting to the PROPOSED values below — flagged PROPOSED because the concurrency
// targets themselves are pending explicit user sign-off (LOCK-D6).

function envInt(name, fallback) {
  const raw = __ENV[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`[stages] env var ${name}="${raw}" is not a valid non-negative integer.`);
  }
  return parsed;
}

/**
 * @param {number} targetVus PROPOSED peak concurrency for this journey (AC-70).
 * @param {{ rampUpS?: number, sustainS?: number, rampDownS?: number }} [durations]
 * @returns {{ stage: string, target: number }[]} k6 `ramping-vus` stages.
 */
export function buildRampStages(targetVus, durations = {}) {
  const rampUpS = durations.rampUpS ?? envInt("K6_RAMP_UP_S", 120);
  const sustainS = durations.sustainS ?? envInt("K6_SUSTAIN_S", 300);
  const rampDownS = durations.rampDownS ?? envInt("K6_RAMP_DOWN_S", 60);

  return [
    { duration: `${rampUpS}s`, target: targetVus },
    { duration: `${sustainS}s`, target: targetVus },
    { duration: `${rampDownS}s`, target: 0 },
  ];
}

export { envInt };
