/**
 * Molden (.molden / .mold / .molf) reader → Mol* orbital data.
 *
 * Molden is the common exchange format for real quantum-chemistry results:
 *   ORCA      orca_2mkl job -molden
 *   Psi4      wfn.molden('file.molden')  /  molden(wfn, ...)
 *   PySCF     pyscf.tools.molden.from_scf(mf, 'file.molden')
 *   xtb       xtb mol.xyz --molden
 *   Gaussian  via Multiwfn / other converters
 *
 * Supported: s, p, sp, d, f, g shells; spherical d/f/g ([5D], [5D7F], [9G], ...),
 * and Cartesian d (converted to spherical, dropping the small r²-type component).
 * Cartesian f/g are not supported — ask the program for spherical output.
 */

import {
    BOHR_PER_ANGSTROM, EV_PER_HARTREE, OrbitalAtom, OrbitalBasis, OrbitalCoefficients,
    OrbitalInfo, OrbitalSet, OrbitalShell
} from './types';
import { topContributions } from './eht';

const SYMBOLS = ['X',
    'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar',
    'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr',
    'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe',
    'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu',
    'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg', 'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn'];

const L_OF: Record<string, number> = { s: 0, p: 1, d: 2, f: 3, g: 4 };

function num(s: string): number {
    return parseFloat(s.replace(/[dD]/, 'e'));
}

function doubleFactorial(n: number): number {
    let r = 1;
    for (let k = n; k > 1; k -= 2) r *= k;
    return r;
}

/** Normalisation of a primitive Racah-normalised real solid harmonic Gaussian (Mol*'s convention). */
function primitiveNorm(a: number, l: number): number {
    return Math.pow(2 * a / Math.PI, 0.75) * Math.pow(4 * a, l / 2) / Math.sqrt(doubleFactorial(2 * l - 1));
}

interface RawShell { l: number; exps: number[]; coefs: number[] }
interface ParsedShell extends RawShell { atom: number }

export function isMoldenText(text: string): boolean {
    return /\[\s*molden\s+format\s*\]/i.test(text.slice(0, 2000)) || (/\[\s*gto\s*\]/i.test(text) && /\[\s*mo\s*\]/i.test(text));
}

export function parseMolden(text: string): OrbitalSet {
    const lines = text.split(/\r?\n/);
    const notes: string[] = [];

    // ---------- section split ----------
    const sections: { name: string; arg: string; body: string[] }[] = [];
    for (const raw of lines) {
        const m = raw.match(/^\s*\[\s*([^\]]+?)\s*\]\s*(.*)$/);
        if (m) {
            sections.push({ name: m[1].toLowerCase(), arg: m[2].trim(), body: [] });
        } else if (sections.length) {
            sections[sections.length - 1].body.push(raw);
        }
    }
    const find = (name: string) => sections.find(s => s.name === name);
    const has = (name: string) => sections.some(s => s.name === name);

    // ---------- atoms ----------
    const atomSec = find('atoms');
    if (!atomSec) throw new Error('Molden file has no [Atoms] section.');
    const inAngstrom = /ang/i.test(atomSec.arg);
    const atoms: OrbitalAtom[] = [];
    const centers: [number, number, number][] = [];
    for (const l of atomSec.body) {
        const t = l.trim().split(/\s+/);
        if (t.length < 6) continue;
        const z = parseInt(t[2], 10);
        const sym = SYMBOLS[z] || t[0].replace(/[^A-Za-z]/g, '');
        const xyz = [num(t[3]), num(t[4]), num(t[5])];
        const f = inAngstrom ? BOHR_PER_ANGSTROM : 1;
        centers.push([xyz[0] * f, xyz[1] * f, xyz[2] * f]);
        atoms.push({ sym, x: xyz[0] * f / BOHR_PER_ANGSTROM, y: xyz[1] * f / BOHR_PER_ANGSTROM, z: xyz[2] * f / BOHR_PER_ANGSTROM });
    }
    if (!atoms.length) throw new Error('No atoms found in Molden [Atoms] section.');

    // ---------- pure/cartesian flags ----------
    // Molden default is Cartesian. [5D] = spherical d & f, [5D10F] = sph d / cart f,
    // [7F] = cart d / sph f, [5D7F] = both spherical, [9G] = spherical g.
    const pureD = has('5d') || has('5d7f') || has('5d10f');
    const pureF = has('5d') || has('5d7f') || has('7f');
    const pureG = has('9g');

    // ---------- basis ----------
    const gtoSec = find('gto');
    if (!gtoSec) throw new Error('Molden file has no [GTO] section (Slater-type [STO] is not supported).');
    const shells: ParsedShell[] = [];
    {
        const body = gtoSec.body;
        let i = 0;
        let atom = -1;
        while (i < body.length) {
            const t = body[i].trim().split(/\s+/);
            if (!body[i].trim()) { i++; continue; }
            if (t.length >= 1 && /^\d+$/.test(t[0]) && (t.length === 1 || /^\d+$/.test(t[1]))) {
                atom = parseInt(t[0], 10) - 1;
                i++;
                continue;
            }
            const type = t[0].toLowerCase();
            const nprim = parseInt(t[1], 10);
            if (!(type in L_OF) && type !== 'sp') throw new Error(`Unsupported shell type "${t[0]}" in Molden [GTO].`);
            const exps: number[] = [], c1: number[] = [], c2: number[] = [];
            for (let k = 0; k < nprim; k++) {
                const p = body[i + 1 + k].trim().split(/\s+/);
                exps.push(num(p[0]));
                c1.push(num(p[1]));
                if (type === 'sp') c2.push(num(p[2]));
            }
            i += nprim + 1;
            if (atom < 0 || atom >= atoms.length) throw new Error('Molden [GTO] refers to an unknown atom.');
            if (type === 'sp') {
                shells.push({ atom, l: 0, exps, coefs: c1 });
                shells.push({ atom, l: 1, exps, coefs: c2 });
            } else {
                shells.push({ atom, l: L_OF[type], exps, coefs: c1 });
            }
        }
    }

    const cartesianF = shells.some(s => s.l === 3) && !pureF;
    const cartesianG = shells.some(s => s.l === 4) && !pureG;
    if (cartesianF || cartesianG) {
        throw new Error('Cartesian f/g functions are not supported — write the Molden file with spherical functions ([5D7F] / [9G]).');
    }
    const cartesianD = shells.some(s => s.l === 2) && !pureD;
    if (cartesianD) notes.push('Cartesian d functions converted to spherical (r² components dropped).');

    // Number of file coefficients per shell, and how they map to Mol* order.
    const fileCount = (l: number) => l === 2 && cartesianD ? 6 : 2 * l + 1;
    const totalFns = shells.reduce((acc, s) => acc + fileCount(s.l), 0);

    // Build Mol* basis (normalised primitive coefficients folded in, contraction renormalised).
    const basisAtoms: OrbitalBasis['atoms'] = centers.map(c => ({ center: c, shells: [] as OrbitalShell[] }));
    for (const sh of shells) {
        const l = sh.l;
        let selfOverlap = 0;
        for (let i = 0; i < sh.exps.length; i++) {
            for (let j = 0; j < sh.exps.length; j++) {
                const ai = sh.exps[i], aj = sh.exps[j];
                selfOverlap += sh.coefs[i] * sh.coefs[j] * Math.pow(2 * Math.sqrt(ai * aj) / (ai + aj), l + 1.5);
            }
        }
        const scale = selfOverlap > 0 ? 1 / Math.sqrt(selfOverlap) : 1;
        basisAtoms[sh.atom].shells.push({
            exponents: sh.exps,
            angularMomentum: [l],
            coefficients: [sh.coefs.map((c, i) => c * scale * primitiveNorm(sh.exps[i], l))]
        });
    }
    // Mol* walks atoms in order and shells in order; so must the coefficient vectors.
    const shellOrder: ParsedShell[] = [];
    basisAtoms.forEach((_, ai) => shells.forEach(s => { if (s.atom === ai) shellOrder.push(s); }));
    const fileOffset = new Map<ParsedShell, number>();
    {
        let o = 0;
        for (const sh of shells) { fileOffset.set(sh, o); o += fileCount(sh.l); }
    }

    const toMolstar = (coef: Float64Array): number[] => {
        const out: number[] = [];
        for (const sh of shellOrder) {
            const o = fileOffset.get(sh)!;
            if (sh.l === 0) {
                out.push(coef[o]);
            } else if (sh.l === 1) {
                // Molden: x, y, z → Mol*: z, x, y
                out.push(coef[o + 2], coef[o], coef[o + 1]);
            } else if (sh.l === 2 && cartesianD) {
                // Molden 6D order: xx, yy, zz, xy, xz, yz (each individually normalised)
                const xx = coef[o], yy = coef[o + 1], zz = coef[o + 2], xy = coef[o + 3], xz = coef[o + 4], yz = coef[o + 5];
                out.push((2 * zz - xx - yy) / 3, xz, yz, (xx - yy) / Math.sqrt(3), xy);
            } else {
                // Spherical: Molden order m = 0, +1, -1, +2, -2, ... is Mol*'s 'gaussian' order.
                for (let k = 0; k < 2 * sh.l + 1; k++) out.push(coef[o + k]);
            }
        }
        return out;
    };

    // Labels for contribution summaries (squared-coefficient weights, overlap ignored).
    const fnLabel: string[] = [];
    for (const sh of shells) {
        const label = `${atoms[sh.atom].sym}${sh.atom + 1} ${'spdfg'[sh.l]}`;
        for (let k = 0; k < fileCount(sh.l); k++) fnLabel.push(label);
    }

    // ---------- MOs ----------
    const moSec = find('mo');
    if (!moSec) throw new Error('Molden file has no [MO] section.');
    interface RawMO { energy: number; occ: number; spin: string; sym: string; coef: Float64Array }
    const mos: RawMO[] = [];
    let cur: RawMO | null = null;
    for (const raw of moSec.body) {
        const l = raw.trim();
        if (!l) continue;
        const kv = l.match(/^(\w+)\s*=\s*(.*)$/);
        if (kv) {
            const key = kv[1].toLowerCase();
            if (!cur || cur.coef.some(v => v !== 0) || key === 'sym' && cur.sym) {
                cur = { energy: 0, occ: 0, spin: 'alpha', sym: '', coef: new Float64Array(totalFns) };
                mos.push(cur);
            }
            if (key === 'ene') cur.energy = num(kv[2]);
            else if (key === 'occup') cur.occ = num(kv[2]);
            else if (key === 'spin') cur.spin = kv[2].trim().toLowerCase();
            else if (key === 'sym') cur.sym = kv[2].trim();
            continue;
        }
        const t = l.split(/\s+/);
        if (cur && t.length >= 2) {
            const idx = parseInt(t[0], 10) - 1;
            if (idx >= 0 && idx < totalFns) cur.coef[idx] = num(t[1]);
        }
    }

    const alphaMos = mos.filter(m => !m.spin.startsWith('b')).sort((a, b) => a.energy - b.energy);
    if (alphaMos.length < mos.length) notes.push('Unrestricted wavefunction: showing alpha-spin orbitals only.');
    if (!alphaMos.length) throw new Error('Molden file contains no orbitals.');

    const orbitals: OrbitalCoefficients[] = [];
    const info: OrbitalInfo[] = [];
    let homo = -1;
    let electrons = 0;
    alphaMos.forEach((mo, k) => {
        orbitals.push({ energy: mo.energy, occupancy: mo.occ, alpha: toMolstar(mo.coef) });
        const groups = new Map<string, number>();
        mo.coef.forEach((c, i) => groups.set(fnLabel[i], (groups.get(fnLabel[i]) || 0) + c * c));
        info.push({ energyEV: mo.energy * EV_PER_HARTREE, occupancy: mo.occ, contributions: topContributions(groups) });
        if (mo.occ > 0.5) homo = k;
        electrons += mo.occ;
    });
    if (alphaMos.length < mos.length) electrons = mos.reduce((acc, m) => acc + m.occ, 0);

    const program = (find('title')?.body.join(' ') || '').trim();
    return {
        method: program ? `Molden · ${program.slice(0, 40)}` : 'Molden file',
        qualitative: false,
        basis: { atoms: basisAtoms },
        order: 'gaussian',
        orbitals,
        info,
        homo,
        electrons: Math.round(electrons),
        atoms,
        notes: [`${atoms.length} atoms · ${totalFns} basis functions · ${alphaMos.length} orbitals`, ...notes]
    };
}
