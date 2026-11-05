/**
 * Orbital data shared by the solvers and the viewer.
 *
 * `OrbitalBasis` and `OrbitalCoefficients` have exactly the shape of Mol*'s
 * `Basis` / `AlphaOrbital` (molstar/lib/extensions/alpha-orbitals/data-model),
 * so they can be passed to StaticBasisAndOrbitals unchanged. They are declared
 * here so the solvers stay free of Mol* imports and can be unit-tested in Node.
 */

export interface OrbitalShell {
    exponents: number[];
    angularMomentum: number[];
    /** One list per angular momentum. Primitive normalisation is already folded in. */
    coefficients: number[][];
}

export interface OrbitalBasis {
    atoms: {
        /** Bohr. */
        center: [number, number, number];
        shells: OrbitalShell[];
    }[];
}

export interface OrbitalCoefficients {
    energy: number;
    occupancy: number;
    alpha: number[];
}

export interface OrbitalAtom {
    sym: string;
    /** Ångström. */
    x: number;
    y: number;
    z: number;
}

export interface OrbitalContribution {
    /** e.g. "O3 2p" */
    label: string;
    /** Fraction 0..1. */
    weight: number;
}

export interface OrbitalInfo {
    energyEV: number;
    occupancy: number;
    /** Largest atomic-orbital contributions, descending. */
    contributions: OrbitalContribution[];
}

export interface OrbitalSet {
    /** Shown in the panel header, e.g. "Extended Hückel" or "Molden · ORCA". */
    method: string;
    /** True for model-level methods meant for qualitative pictures. */
    qualitative: boolean;
    basis: OrbitalBasis;
    /** Always 'gaussian' (Mol*'s m-ordering: 0, +1, -1, +2, -2, ...). */
    order: 'gaussian';
    orbitals: OrbitalCoefficients[];
    info: OrbitalInfo[];
    /** Index of the HOMO, or -1 if nothing is occupied. */
    homo: number;
    electrons: number;
    atoms: OrbitalAtom[];
    notes: string[];
}

export const BOHR_PER_ANGSTROM = 1 / 0.529177210903;
export const EV_PER_HARTREE = 27.211386245988;

/** Human label relative to the frontier orbitals: HOMO, HOMO-2, LUMO+1, ... */
export function frontierLabel(index: number, homo: number): string {
    if (homo < 0) return `MO ${index + 1}`;
    if (index === homo) return 'HOMO';
    if (index === homo + 1) return 'LUMO';
    if (index < homo) return `HOMO-${homo - index}`;
    return `LUMO+${index - homo - 1}`;
}

/**
 * Parse "HOMO", "LUMO+2", "homo-1", "12" (1-based MO number) into an orbital index.
 * Returns null for unrecognised input.
 */
export function parseOrbitalSelector(spec: string, set: OrbitalSet): number | null {
    const s = spec.trim().toUpperCase().replace(/\s+/g, '');
    const m = s.match(/^(HOMO|LUMO)([+-]\d+)?$/);
    let idx: number | null = null;
    if (m) {
        const base = m[1] === 'HOMO' ? set.homo : set.homo + 1;
        idx = base + (m[2] ? parseInt(m[2], 10) : 0);
    } else if (/^\d+$/.test(s)) {
        idx = parseInt(s, 10) - 1;
    }
    if (idx === null || idx < 0 || idx >= set.orbitals.length) return null;
    return idx;
}
