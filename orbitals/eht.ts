/**
 * Extended Hückel Theory (Hoffmann, 1963) for any small organic molecule.
 *
 * This is the classic qualitative MO method used in teaching: a minimal valence
 * basis of Slater orbitals, H_ii from valence-state ionisation energies and
 * H_ij from the (weighted) Wolfsberg–Helmholz formula. It has no
 * self-consistency and no electron repulsion, so energies are only qualitative,
 * but orbital shapes, nodal structure and HOMO/LUMO character come out right
 * for ordinary organic molecules — which is what an orbital picture is for.
 *
 * Slater orbitals are expanded in 6 Gaussians (STO-6G-style fits, overlap > 0.99999
 * with the exact Slater function) so the result plugs straight into Mol*'s
 * GPU orbital renderer.
 */

import { generalizedEigen } from './linalg';
import {
    BOHR_PER_ANGSTROM, OrbitalAtom, OrbitalBasis, OrbitalCoefficients, OrbitalContribution,
    OrbitalInfo, OrbitalSet, OrbitalShell
} from './types';

/** Least-squares Gaussian fits of normalised Slater functions with zeta = 1 (exponents scale with zeta^2). */
const STO_6G: Record<string, { exps: number[]; coefs: number[] }> = {
    '1s': { exps: [23.1030321, 4.2359192, 1.18505917, 0.407099652, 0.158088553, 0.0651095722], coefs: [0.00916359712, 0.0493613824, 0.168537835, 0.370562742, 0.416491978, 0.130334272] },
    '2s': { exps: [27.6850272, 5.07713399, 1.42678729, 0.204033352, 0.0926028966, 0.0441618182], coefs: [-0.00415128416, -0.0206702451, -0.0515029768, 0.334627884, 0.562105684, 0.1712991] },
    '2p': { exps: [5.86830077, 1.53033104, 0.547566784, 0.228893361, 0.104665629, 0.0494822046], coefs: [0.00792421092, 0.0514410109, 0.189839929, 0.404986234, 0.40123645, 0.10518558] },
    '3s': { exps: [3.74572353, 1.04063678, 0.387558055, 0.0791720303, 0.0395555558, 0.0083919546], coefs: [-0.00508530049, -0.0464391608, -0.161373986, 0.706590221, 0.409558775, 0.00208699775] },
    '3p': { exps: [5.07795654, 1.3407857, 0.224843947, 0.113174626, 0.0607644141, 0.0331544315], coefs: [-0.00332993721, -0.0141948902, 0.163938303, 0.448533176, 0.390883203, 0.0741166026] },
    '4s': { exps: [2.58901715, 0.456383655, 0.272796375, 0.170497612, 0.0502673762, 0.0280132275], coefs: [0.00182493491, -0.0323628876, -0.0853865019, -0.273667544, 0.90010062, 0.336133852] },
    '4p': { exps: [2.38984844, 0.796130019, 0.341559274, 0.0884737962, 0.0495820263, 0.0281690195], coefs: [-0.00166565501, -0.0165735921, -0.0595859347, 0.405319595, 0.543393231, 0.120491089] },
    '5s': { exps: [0.701560401, 0.175490821, 0.108073654, 0.0363361516, 0.0218804789], coefs: [0.0152792687, -0.0826590061, -0.519156331, 1.0988481, 0.290846638] },
    '5p': { exps: [0.345222979, 0.168119667, 0.0537000648, 0.032939352, 0.0205795852], coefs: [-0.0300295596, -0.136768678, 0.584378623, 0.465792194, 0.0570612556] },
};

interface ShellParam { shell: string; Hii: number; zeta: number }

/**
 * Standard EHT parameters (Hoffmann and later; the defaults used by YAeHMOP).
 * Hii in eV, Slater exponents in bohr^-1. d-orbitals of 3rd-row atoms are omitted,
 * as in the classic organic parameter set.
 */
const EHT_PARAMS: Record<string, { valence: number; shells: ShellParam[] }> = {
    H: { valence: 1, shells: [{ shell: '1s', Hii: -13.6, zeta: 1.3 }] },
    B: { valence: 3, shells: [{ shell: '2s', Hii: -15.2, zeta: 1.3 }, { shell: '2p', Hii: -8.5, zeta: 1.3 }] },
    C: { valence: 4, shells: [{ shell: '2s', Hii: -21.4, zeta: 1.625 }, { shell: '2p', Hii: -11.4, zeta: 1.625 }] },
    N: { valence: 5, shells: [{ shell: '2s', Hii: -26.0, zeta: 1.95 }, { shell: '2p', Hii: -13.4, zeta: 1.95 }] },
    O: { valence: 6, shells: [{ shell: '2s', Hii: -32.3, zeta: 2.275 }, { shell: '2p', Hii: -14.8, zeta: 2.275 }] },
    F: { valence: 7, shells: [{ shell: '2s', Hii: -40.0, zeta: 2.425 }, { shell: '2p', Hii: -18.1, zeta: 2.425 }] },
    Si: { valence: 4, shells: [{ shell: '3s', Hii: -17.3, zeta: 1.383 }, { shell: '3p', Hii: -9.2, zeta: 1.383 }] },
    P: { valence: 5, shells: [{ shell: '3s', Hii: -18.6, zeta: 1.75 }, { shell: '3p', Hii: -14.0, zeta: 1.3 }] },
    S: { valence: 6, shells: [{ shell: '3s', Hii: -20.0, zeta: 2.122 }, { shell: '3p', Hii: -11.0, zeta: 1.827 }] },
    Cl: { valence: 7, shells: [{ shell: '3s', Hii: -26.3, zeta: 2.183 }, { shell: '3p', Hii: -14.2, zeta: 1.733 }] },
    Br: { valence: 7, shells: [{ shell: '4s', Hii: -22.07, zeta: 2.588 }, { shell: '4p', Hii: -13.1, zeta: 2.131 }] },
    I: { valence: 7, shells: [{ shell: '5s', Hii: -18.0, zeta: 2.679 }, { shell: '5p', Hii: -12.7, zeta: 2.322 }] },
};

export const EHT_ELEMENTS = Object.keys(EHT_PARAMS);

/** Largest basis the in-browser solver will attempt (≈ 150 heavy atoms). */
const MAX_BASIS = 700;

/** One contracted Cartesian basis function; p uses component 0/1/2 = x/y/z. */
interface BasisFn {
    atom: number;
    l: 0 | 1;
    comp: number;
    center: [number, number, number];
    exps: number[];
    /** Coefficients of *unnormalised* primitives x^l exp(-a r^2), contraction normalised. */
    coefs: number[];
    Hii: number;
    label: string;
}

function normaliseSymbol(sym: string): string {
    const s = sym.trim();
    return s.length <= 1 ? s.toUpperCase() : s[0].toUpperCase() + s.slice(1).toLowerCase();
}

/** Overlap of two unnormalised primitives on centres A, B (s or Cartesian p). */
function primitiveOverlap(
    a: number, A: [number, number, number], la: number, ia: number,
    b: number, B: [number, number, number], lb: number, ib: number
): number {
    const p = a + b;
    const dx = A[0] - B[0], dy = A[1] - B[1], dz = A[2] - B[2];
    const base = Math.pow(Math.PI / p, 1.5) * Math.exp(-a * b / p * (dx * dx + dy * dy + dz * dz));
    if (la === 0 && lb === 0) return base;
    const PA = [(a * A[0] + b * B[0]) / p - A[0], (a * A[1] + b * B[1]) / p - A[1], (a * A[2] + b * B[2]) / p - A[2]];
    const PB = [(a * A[0] + b * B[0]) / p - B[0], (a * A[1] + b * B[1]) / p - B[1], (a * A[2] + b * B[2]) / p - B[2]];
    if (la === 1 && lb === 0) return PA[ia] * base;
    if (la === 0 && lb === 1) return PB[ib] * base;
    return (PA[ia] * PB[ib] + (ia === ib ? 1 / (2 * p) : 0)) * base;
}

function contractedOverlap(f: BasisFn, g: BasisFn): number {
    let s = 0;
    for (let i = 0; i < f.exps.length; i++) {
        for (let j = 0; j < g.exps.length; j++) {
            s += f.coefs[i] * g.coefs[j] * primitiveOverlap(f.exps[i], f.center, f.l, f.comp, g.exps[j], g.center, g.l, g.comp);
        }
    }
    return s;
}

/** Primitive normalisation constant for x^l exp(-a r^2), l = 0 or 1. */
function primitiveNorm(a: number, l: number): number {
    const n = Math.pow(2 * a / Math.PI, 0.75);
    return l === 0 ? n : n * 2 * Math.sqrt(a);
}

export interface EhtOptions {
    /** Total molecular charge. */
    charge?: number;
    /** Wolfsberg–Helmholz constant, 1.75 by convention. */
    K?: number;
}

export function computeExtendedHuckel(inputAtoms: OrbitalAtom[], options: EhtOptions = {}): OrbitalSet {
    const K = options.K ?? 1.75;
    const charge = options.charge ?? 0;
    const atoms = inputAtoms.map(a => ({ ...a, sym: normaliseSymbol(a.sym) }));

    if (atoms.length === 0) throw new Error('No atoms to compute orbitals for.');
    const unsupported = Array.from(new Set(atoms.map(a => a.sym).filter(s => !EHT_PARAMS[s])));
    if (unsupported.length) {
        throw new Error(`Extended Hückel has no parameters for ${unsupported.join(', ')} (supported: ${EHT_ELEMENTS.join(', ')}).`);
    }

    const notes: string[] = [];
    const hasCarbon = atoms.some(a => a.sym === 'C');
    if (hasCarbon && !atoms.some(a => a.sym === 'H')) {
        notes.push('No hydrogens in this structure — add explicit H atoms for meaningful orbitals.');
    }

    // --- Basis ---
    const fns: BasisFn[] = [];
    const shells: OrbitalShell[][] = atoms.map(() => []);
    const elementCount: Record<string, number> = {};

    atoms.forEach((atom, ai) => {
        elementCount[atom.sym] = (elementCount[atom.sym] || 0) + 1;
        const atomLabel = `${atom.sym}${ai + 1}`;
        const center: [number, number, number] = [atom.x * BOHR_PER_ANGSTROM, atom.y * BOHR_PER_ANGSTROM, atom.z * BOHR_PER_ANGSTROM];

        for (const sp of EHT_PARAMS[atom.sym].shells) {
            const fit = STO_6G[sp.shell];
            const l = sp.shell.endsWith('p') ? 1 : 0;
            const exps = fit.exps.map(e => e * sp.zeta * sp.zeta);
            let coefs = fit.coefs.map((c, i) => c * primitiveNorm(exps[i], l));

            // Renormalise the contraction exactly in this primitive set.
            const probe: BasisFn = { atom: ai, l: l as 0 | 1, comp: 0, center, exps, coefs, Hii: 0, label: '' };
            const norm = 1 / Math.sqrt(contractedOverlap(probe, probe));
            coefs = coefs.map(c => c * norm);

            const comps = l === 0 ? [0] : [0, 1, 2];
            for (const comp of comps) {
                fns.push({
                    atom: ai, l: l as 0 | 1, comp, center, exps, coefs, Hii: sp.Hii,
                    label: `${atomLabel} ${sp.shell}`
                });
            }

            // Mol* real solid harmonics: L=0 -> c * exp(..); L=1 -> (a0 z + a1 x + a2 y) * exp(..)
            // which matches the unnormalised Cartesian p primitives used above.
            shells[ai].push({ exponents: exps, angularMomentum: [l], coefficients: [coefs] });
        }
    });

    const n = fns.length;
    if (n > MAX_BASIS) {
        throw new Error(`Molecule too large for in-browser Extended Hückel (${n} basis functions, limit ${MAX_BASIS}).`);
    }

    // --- Overlap and Hamiltonian ---
    const S = new Float64Array(n * n);
    const H = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
        S[i * n + i] = 1;
        H[i * n + i] = fns[i].Hii;
        for (let j = 0; j < i; j++) {
            if (fns[i].atom === fns[j].atom) continue; // same-centre s/p functions are orthogonal
            const s = contractedOverlap(fns[i], fns[j]);
            S[i * n + j] = S[j * n + i] = s;
            // Weighted Wolfsberg–Helmholz (Ammeter et al. 1978), YAeHMOP default.
            const hi = fns[i].Hii, hj = fns[j].Hii;
            const delta = (hi - hj) / (hi + hj);
            const kw = K + delta * delta + delta * delta * delta * delta * (1 - K);
            const h = 0.5 * kw * (hi + hj) * s;
            H[i * n + j] = H[j * n + i] = h;
        }
    }

    const { values, vectors } = generalizedEigen(H, S, n);

    // --- Occupation ---
    const valence = atoms.reduce((acc, a) => acc + EHT_PARAMS[a.sym].valence, 0);
    const electrons = valence - charge;
    if (electrons < 0 || electrons > 2 * n) throw new Error(`Impossible electron count (${electrons}) for charge ${charge}.`);
    const occupancies = new Array<number>(n).fill(0);
    let remaining = electrons;
    for (let k = 0; k < n && remaining > 0; k++) {
        occupancies[k] = Math.min(2, remaining);
        remaining -= occupancies[k];
    }
    let homo = -1;
    for (let k = 0; k < n; k++) if (occupancies[k] > 0) homo = k;
    if (electrons % 2 === 1) notes.push('Odd electron count: the HOMO is singly occupied (radical).');

    // --- Mol* coefficient vectors (per atom: s, then p in Mol* order z, x, y) ---
    // Basis functions were pushed per atom as [s] [px py pz] (and only those), so map them.
    const orbitals: OrbitalCoefficients[] = [];
    const info: OrbitalInfo[] = [];
    const SC = new Float64Array(n);

    for (let k = 0; k < n; k++) {
        const c = new Float64Array(n);
        for (let i = 0; i < n; i++) c[i] = vectors[i * n + k];

        const alpha: number[] = [];
        for (let i = 0; i < n; i++) {
            const f = fns[i];
            if (f.l === 0) {
                alpha.push(c[i]);
            } else if (f.comp === 0) {
                // i, i+1, i+2 are px, py, pz of the same shell.
                alpha.push(c[i + 2], c[i], c[i + 1]);
            }
        }
        orbitals.push({ energy: values[k], occupancy: occupancies[k], alpha });

        // Mulliken gross populations of this MO, grouped by "atom shell".
        for (let i = 0; i < n; i++) {
            let s = 0;
            for (let j = 0; j < n; j++) s += S[i * n + j] * c[j];
            SC[i] = s;
        }
        const groups = new Map<string, number>();
        for (let i = 0; i < n; i++) groups.set(fns[i].label, (groups.get(fns[i].label) || 0) + c[i] * SC[i]);
        info.push({ energyEV: values[k], occupancy: occupancies[k], contributions: topContributions(groups) });
    }

    const formula = Object.entries(elementCount).map(([el, cnt]) => cnt > 1 ? `${el}${cnt}` : el).join('');
    return {
        method: 'Extended Hückel',
        qualitative: true,
        basis: { atoms: atoms.map((_, i) => ({ center: fns.find(f => f.atom === i)!.center, shells: shells[i] })) } as OrbitalBasis,
        order: 'gaussian',
        orbitals,
        info,
        homo,
        electrons,
        atoms,
        notes: [`${formula} · ${electrons} valence electrons · ${n} basis functions`, ...notes]
    };
}

export function topContributions(groups: Map<string, number>, max = 4): OrbitalContribution[] {
    let total = 0;
    for (const v of groups.values()) total += Math.max(0, v);
    if (total <= 0) return [];
    return Array.from(groups.entries())
        .map(([label, v]) => ({ label, weight: Math.max(0, v) / total }))
        .filter(c => c.weight >= 0.04)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, max);
}
