// Doodson coefficients and FES nodal corrections follow the PyTMD implementation
// (MIT, https://github.com/pyTMD/pyTMD); reference version 3.0.9.
const CONSTITUENTS = ['2N2', 'J1', 'K1', 'K2', 'M2', 'M4', 'MF', 'MM', 'N2', 'O1', 'P1', 'Q1', 'S1', 'S2', 'SA', 'SSA', 'T2'];
const DOODSON = {
  '2N2': [2, -2, 0, 2, 0, 0, 0], J1: [1, 2, 0, -1, 0, 0, 1], K1: [1, 1, 0, 0, 0, 0, 1],
  K2: [2, 2, 0, 0, 0, 0, 0], M2: [2, 0, 0, 0, 0, 0, 0], M4: [4, 0, 0, 0, 0, 0, 0],
  MF: [0, 2, 0, 0, 0, 0, 0], MM: [0, 1, 0, -1, 0, 0, 0], N2: [2, -1, 0, 1, 0, 0, 0],
  O1: [1, -1, 0, 0, 0, 0, -1], P1: [1, 1, -2, 0, 0, 0, -1], Q1: [1, -2, 0, 1, 0, 0, -1],
  S1: [1, 1, -1, 0, 0, 0, 2], S2: [2, 2, -2, 0, 0, 0, 0], SA: [0, 0, 1, 0, 0, -1, 0],
  SSA: [0, 0, 2, 0, 0, 0, 0], T2: [2, 2, -3, 0, 0, 1, 0]
};
const radians = degrees => degrees * Math.PI / 180;
const normalize = value => ((value % 360) + 360) % 360;
function polynomial(coefficients, x) {
  let value = 0;
  for (let i = coefficients.length - 1; i >= 0; i -= 1) value = value * x + coefficients[i];
  return value;
}

function astronomicalArguments(timestamp) {
  const mjd = timestamp / 86400000 + 40587;
  const T = (mjd - 51544.5) / 36525;
  const lunar = [218.3164477, 481267.88123421, -1.5786e-3, 1.855835e-6, -1.53388e-8];
  const elongation = [297.8501921, 445267.1114034, -1.8819e-3, 1.83195e-6, -8.8445e-9];
  const s = normalize(polynomial(lunar, T));
  const h = normalize(polynomial(lunar.map((value, i) => value - elongation[i]), T));
  const p = normalize(polynomial([83.3532465, 4069.0137287, -1.032e-2, -1.249e-5], T));
  const n = normalize(polynomial([125.04452, -1934.136261, 2.0708e-3, 2.22222e-6], T));
  const pp = normalize(282.94 + 1.7192 * T);
  const hour = ((mjd % 1) + 1) % 1 * 24;
  return { mjd, s, h, p, n, pp, tau: 15 * hour - s + h };
}

function schureman(pDeg, nDeg) {
  const p = radians(pDeg), n = radians(nDeg);
  const I = Math.acos(0.913694997 - 0.035692561 * Math.cos(n));
  const at1 = Math.atan(1.01883 * Math.tan(n / 2));
  const at2 = Math.atan(0.64412 * Math.tan(n / 2));
  const xi = Math.atan2(Math.sin(-at1 - at2 + n), Math.cos(-at1 - at2 + n));
  const nu = at1 - at2;
  const nup = Math.atan2(Math.sin(2 * I) * Math.sin(nu), Math.sin(2 * I) * Math.cos(nu) + 0.3347);
  const nus = 0.5 * Math.atan2(Math.sin(I) ** 2 * Math.sin(2 * nu), Math.sin(I) ** 2 * Math.cos(2 * nu) + 0.0727);
  return { I, xi, nu, nup, nus };
}

function nodal(name, angles) {
  const { I, xi, nu, nup, nus } = schureman(angles.p, angles.n);
  if (['M2', 'N2', '2N2'].includes(name)) return { f: Math.cos(I / 2) ** 4 / 0.9154, u: 2 * xi - 2 * nu };
  if (name === 'M4') {
    const m2 = nodal('M2', angles);
    return { f: m2.f ** 2, u: 2 * m2.u };
  }
  if (name === 'O1' || name === 'Q1') return { f: Math.sin(I) * Math.cos(I / 2) ** 2 / 0.38, u: 2 * xi - nu };
  if (name === 'J1') return { f: Math.sin(2 * I) / 0.7214, u: -nu };
  if (name === 'K1') return { f: Math.sqrt(0.8965 * Math.sin(2 * I) ** 2 + 0.6001 * Math.sin(2 * I) * Math.cos(nu) + 0.1006), u: -nup };
  if (name === 'K2') return { f: Math.sqrt(19.0444 * Math.sin(I) ** 4 + 2.7702 * Math.sin(I) ** 2 * Math.cos(2 * nu) + 0.0981), u: -2 * nus };
  if (name === 'MF') return { f: Math.sin(I) ** 2 / 0.1578, u: -2 * xi };
  if (name === 'MM') return { f: Math.abs((2 / 3 - Math.sin(I) ** 2) / 0.5021), u: 0 };
  return { f: 1, u: 0 };
}

function harmonicTerms(timestamp) {
  const a = astronomicalArguments(timestamp);
  const args = [a.tau, a.s, a.h, a.p, a.n, a.pp, 90];
  return CONSTITUENTS.map(name => {
    const doodson = DOODSON[name];
    const G = doodson.reduce((sum, coefficient, i) => sum + coefficient * args[i], 0);
    const { f, u } = nodal(name, a);
    const theta = radians(G) + u;
    return [f * Math.cos(theta), -f * Math.sin(theta)];
  });
}

export function createHarmonicPredictor(timestamp) {
  const terms = harmonicTerms(timestamp);
  return coefficients => {
    let centimeters = 0;
    for (let index = 0; index < terms.length; index += 1) {
      const [real, imaginary] = coefficients[index];
      centimeters += real * terms[index][0] + imaginary * terms[index][1];
    }
    return centimeters / 100;
  };
}

// Native model chunks already store each node's constituent pairs contiguously.
// Reading those Float32 values directly avoids allocating nested arrays for
// every node when a new chunk/time prediction grid is first requested.
export function createHarmonicRecordPredictor(timestamp) {
  const terms = harmonicTerms(timestamp);
  return (data, offset, stride = 8) => {
    let centimeters = 0;
    for (let index = 0; index < terms.length; index += 1) {
      const [realTerm, imaginaryTerm] = terms[index];
      centimeters += data.getFloat32(offset + index * stride, true) * realTerm
        + data.getFloat32(offset + index * stride + 4, true) * imaginaryTerm;
    }
    return centimeters / 100;
  };
}

export function predictHarmonic(coefficients, timestamp) {
  return createHarmonicPredictor(timestamp)(coefficients);
}

export { CONSTITUENTS };
