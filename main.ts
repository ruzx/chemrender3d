import { Plugin, PluginSettingTab, App, Setting, TFile, MarkdownRenderChild, requestUrl, Notice, parseYaml, Modal } from 'obsidian';
import { createPluginUI } from 'molstar/lib/mol-plugin-ui';
import { renderReact18 } from 'molstar/lib/mol-plugin-ui/react18';
import { Color } from 'molstar/lib/mol-util/color';
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";

// --- Global Silencing of Mol* duplicate registration spam ---
const origConsoleWarn = console.warn;
console.warn = (...args: any[]) => {
    if (typeof args[0] === 'string' && (args[0].includes('already added') || args[0].includes('computed.accessible-surface-area'))) return;
    origConsoleWarn.apply(console, args);
};

// Periodic table dictionary for element colors and inspection
const ELEMENT_DATA: Record<string, { name: string; number: number; mass: number; color: string }> = {
    H: { name: 'Hydrogen', number: 1, mass: 1.008, color: '#FFFFFF' },
    B: { name: 'Boron', number: 5, mass: 10.81, color: '#FFB5B5' },
    C: { name: 'Carbon', number: 6, mass: 12.011, color: '#333333' },
    N: { name: 'Nitrogen', number: 7, mass: 14.007, color: '#3050F8' },
    O: { name: 'Oxygen', number: 8, mass: 15.999, color: '#FF0D0D' },
    F: { name: 'Fluorine', number: 9, mass: 18.998, color: '#90E050' },
    Na: { name: 'Sodium', number: 11, mass: 22.990, color: '#AB5CF2' },
    Mg: { name: 'Magnesium', number: 12, mass: 24.305, color: '#8AFF00' },
    Al: { name: 'Aluminium', number: 13, mass: 26.982, color: '#BFA6A6' },
    Si: { name: 'Silicon', number: 14, mass: 28.085, color: '#F0C8A0' },
    P: { name: 'Phosphorus', number: 15, mass: 30.974, color: '#FF8000' },
    S: { name: 'Sulfur', number: 16, mass: 32.06, color: '#FFFF30' },
    Cl: { name: 'Chlorine', number: 17, mass: 35.45, color: '#1FF01F' },
    K: { name: 'Potassium', number: 19, mass: 39.098, color: '#8F40D4' },
    Ca: { name: 'Calcium', number: 20, mass: 40.078, color: '#3DFF00' },
    Ti: { name: 'Titanium', number: 22, mass: 47.867, color: '#BFC2C7' },
    Fe: { name: 'Iron', number: 26, mass: 55.845, color: '#E06633' },
    Cu: { name: 'Copper', number: 29, mass: 63.546, color: '#C88033' },
    Zn: { name: 'Zinc', number: 30, mass: 65.38, color: '#7D80B0' },
    Br: { name: 'Bromine', number: 35, mass: 79.904, color: '#A62929' },
    Sr: { name: 'Strontium', number: 38, mass: 87.62, color: '#00FF00' },
    I: { name: 'Iodine', number: 53, mass: 126.90, color: '#940094' },
    Ba: { name: 'Barium', number: 56, mass: 137.33, color: '#00C900' }
};

interface EmbedSize {
    width?: string;
    height?: string;
}

interface RenderData extends EmbedSize {
    type: 'file' | 'smiles' | 'pdb' | 'afdb' | 'pubchem' | 'raw_vasp';
    content: string;
    sourcePath: string;
    supercell?: string;
}

interface ChemRender3DSettings {
    autoPlayTrajectory: boolean;
    autoSpinCamera: boolean;
    showUIPanels: boolean;
    showQuickToolbar: boolean;
    viewerHeight: string;
    supportedExtensions: string;
    showNonCovalent: boolean;
    maxPixelRatio: number;
    preventAppClick: boolean;
    defaultPreset: 'auto' | 'illustrative' | 'polymer-and-ligand';
    gridMaxFiles: number;
    defaultGridColumns: number;
    poscarSupercell: string;
}

const DEFAULT_SETTINGS: ChemRender3DSettings = {
    autoPlayTrajectory: true,
    autoSpinCamera: false,
    showUIPanels: false,
    showQuickToolbar: true,
    viewerHeight: '400px',
    supportedExtensions: 'pdb, ent, pdbqt, pqr, cif, mmcif, gro, mol, mol2, sdf, sd, xyz, cube, cub, poscar, contcar, xdatcar, vasp, gjf, com, in, pwi, molx, molj',
    showNonCovalent: false,
    maxPixelRatio: 1.0,
    preventAppClick: true,
    defaultPreset: 'auto',
    gridMaxFiles: 18,
    defaultGridColumns: 3,
    poscarSupercell: '1 1 1'
};

const FORMAT_MAP: Record<string, string> = {
    'pdb': 'pdb',
    'ent': 'pdb',
    'pdbqt': 'pdbqt',
    'pqr': 'pqr',
    'cif': 'mmcif',
    'mmcif': 'mmcif',
    'mcif': 'mmcif',
    'gro': 'gro',
    'mol': 'mol',
    'mol2': 'mol2',
    'sdf': 'sdf',
    'sd': 'sdf',
    'xyz': 'xyz',
    'cube': 'cube',
    'cub': 'cube',
    'poscar': 'vasp',
    'contcar': 'vasp',
    'xdatcar': 'xdatcar',
    'vasp': 'vasp',
    'gjf': 'gaussian',
    'com': 'gaussian',
    'in': 'qe',
    'pwi': 'qe',
    'molx': 'molx',
    'molj': 'molj'
};

// Mol* session files (.molx zipped, .molj plain JSON) are whole saved plugin states:
// they carry their own structures, representations, colours and camera, so they bypass
// the parse-and-apply-a-preset pipeline the other formats go through.
function isSessionFormat(format: string | null): boolean {
    return format === 'molx' || format === 'molj';
}

function getActiveExtensions(settings: ChemRender3DSettings): string[] {
    return settings.supportedExtensions
        .split(',')
        .map(s => s.trim().toLowerCase().replace(/^\./, ''))
        .filter(s => s.length > 0);
}

function isFileSupported(cleanSrc: string, settings: ChemRender3DSettings): boolean {
    const ext = cleanSrc.split('.').pop()?.toLowerCase() || '';
    const active = getActiveExtensions(settings);
    if (active.includes(ext) || ext in FORMAT_MAP) return true;
    const lower = cleanSrc.toLowerCase();
    if (lower.includes('poscar') || lower.includes('contcar') || lower.includes('xdatcar')) return true;
    return false;
}

/**
 * Read Obsidian's embed size suffix: `|WIDTH` or `|WIDTHxHEIGHT`, in pixels.
 * Anything before the last `|` is display text, so only the last segment is tried,
 * and a segment that is not a size (a caption, say) leaves the viewer at its default.
 */
function parseEmbedSize(link: string): EmbedSize {
    const spec = link.split('|').pop()?.trim() || '';
    const match = spec.match(/^([1-9]\d*)(?:\s*[x\u00d7]\s*([1-9]\d*))?$/i);
    if (!match) return {};
    return {
        width: `${match[1]}px`,
        // As with images, a width on its own leaves the height alone.
        height: match[2] ? `${match[2]}px` : undefined
    };
}

/** Match the host embed element to the viewer, so an inline embed is not left full width. */
function applyHostWidth(embed: HTMLElement, size: EmbedSize): void {
    if (size.width) embed.style.width = size.width;
    else embed.style.removeProperty('width');
}

/** Split an embed target into the vault path and the size that was asked for. */
function parseEmbedLink(raw: string): { path: string; size: EmbedSize } {
    const decoded = decodeURIComponent(raw);
    return {
        path: decoded.split('#')[0].split('?')[0].split('|')[0].trim(),
        size: parseEmbedSize(decoded)
    };
}

/**
 * Size of a rendered embed element. Obsidian may leave the suffix in `src`, move it to
 * `alt`, or split it into `width`/`height` attributes, so all three are checked.
 */
function parseEmbedElementSize(embed: Element, src: string): EmbedSize {
    const widthAttr = embed.getAttribute('width') || '';
    if (/^[1-9]\d*$/.test(widthAttr)) {
        const heightAttr = embed.getAttribute('height') || '';
        return {
            width: `${widthAttr}px`,
            height: /^[1-9]\d*$/.test(heightAttr) ? `${heightAttr}px` : undefined
        };
    }

    const fromSrc = parseEmbedSize(decodeURIComponent(src));
    if (fromSrc.width) return fromSrc;

    return parseEmbedSize(embed.getAttribute('alt') || '');
}

function resolveVaultFile(app: App, linkpath: string, sourcePath: string): TFile | null {
    let file = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
    if (file instanceof TFile) return file;

    let abstractFile = app.vault.getAbstractFileByPath(linkpath);
    if (abstractFile instanceof TFile) return abstractFile;

    if (sourcePath) {
        const lastSlash = sourcePath.lastIndexOf('/');
        const parentDir = lastSlash !== -1 ? sourcePath.substring(0, lastSlash) : '';
        const relPath = parentDir ? `${parentDir}/${linkpath}` : linkpath;
        abstractFile = app.vault.getAbstractFileByPath(relPath);
        if (abstractFile instanceof TFile) return abstractFile;
    }

    const cleanName = linkpath.split('/').pop()?.toLowerCase() || '';
    const match = app.vault.getFiles().find(f => f.name.toLowerCase() === cleanName);
    return match || null;
}

function detectFormat(file: TFile): string | null {
    const ext = file.extension.toLowerCase();
    if (ext && ext in FORMAT_MAP) return FORMAT_MAP[ext];
    const nameLower = file.name.toLowerCase();
    if (nameLower.includes('poscar')) return 'vasp';
    if (nameLower.includes('contcar')) return 'vasp';
    if (nameLower.includes('xdatcar')) return 'xdatcar';
    return null;
}

function isRawVasp(text: string): boolean {
    const lines = text.trim().split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 8) return false;
    const scale = parseFloat(lines[1]);
    if (isNaN(scale) || lines[1].split(/\s+/).length !== 1) return false;
    for (let i = 2; i <= 4; i++) {
        const tokens = lines[i].split(/\s+/).map(Number);
        if (tokens.length !== 3 || tokens.some(isNaN)) return false;
    }
    return true;
}

// =========================================================================
// UNIVERSAL MOLECULAR PARSERS
// =========================================================================

function padLeft(s: string, len: number): string {
    return s.length >= len ? s : ' '.repeat(len - s.length) + s;
}

function padRight(s: string, len: number): string {
    return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

function formatPdbRecord(index: number, sym: string, x: number, y: number, z: number): string {
    const idx = padLeft((index % 99999).toString(), 5);
    const atomName = sym.length === 1 ? ` ${sym}  ` : padRight(` ${sym}`, 4);
    const xs = padLeft(x.toFixed(3), 8);
    const ys = padLeft(y.toFixed(3), 8);
    const zs = padLeft(z.toFixed(3), 8);
    const el = padLeft(sym.toUpperCase(), 2);
    return `HETATM${idx} ${atomName} LIG A   1    ${xs}${ys}${zs}  1.00  0.00          ${el}`;
}

function parseMolFile(text: string): { atoms: { sym: string; x: number; y: number; z: number }[]; bonds: { a1: number; a2: number; type: number }[]; formula: string } {
    const lines = text.split(/\r?\n/);
    const atoms: { sym: string; x: number; y: number; z: number }[] = [];
    const bonds: { a1: number; a2: number; type: number }[] = [];
    const counts: Record<string, number> = {};

    let v2000Idx = -1;
    for (let i = 0; i < Math.min(lines.length, 12); i++) {
        if (lines[i].includes('V2000')) {
            v2000Idx = i;
            break;
        }
    }

    if (v2000Idx !== -1) {
        const line = lines[v2000Idx].trim();
        const tokens = line.split(/\s+/);
        const numAtoms = parseInt(tokens[0], 10);
        const numBonds = parseInt(tokens[1], 10);

        for (let j = 0; j < numAtoms && (v2000Idx + 1 + j) < lines.length; j++) {
            const atomLine = lines[v2000Idx + 1 + j].trim();
            const parts = atomLine.split(/\s+/);
            if (parts.length >= 4) {
                const x = parseFloat(parts[0]);
                const y = parseFloat(parts[1]);
                const z = parseFloat(parts[2]);
                const sym = parts[3].replace(/[^a-zA-Z]/g, '') || 'C';
                atoms.push({ sym, x, y, z: isNaN(z) ? 0 : z });
                counts[sym] = (counts[sym] || 0) + 1;
            }
        }

        const bondStart = v2000Idx + 1 + numAtoms;
        for (let k = 0; k < numBonds && (bondStart + k) < lines.length; k++) {
            const bondLine = lines[bondStart + k].trim();
            const bParts = bondLine.split(/\s+/);
            if (bParts.length >= 3) {
                const a1 = parseInt(bParts[0], 10) - 1;
                const a2 = parseInt(bParts[1], 10) - 1;
                const type = parseInt(bParts[2], 10) || 1;
                if (a1 >= 0 && a1 < atoms.length && a2 >= 0 && a2 < atoms.length) {
                    bonds.push({ a1, a2, type });
                }
            }
        }

        const formula = Object.entries(counts).map(([el, c]) => c > 1 ? `${el}${c}` : el).join('') + ` · ${atoms.length} atoms`;
        return { atoms, bonds, formula };
    }

    for (const l of lines) {
        if (l.startsWith('$$$$')) break;
        const p = l.trim().split(/\s+/);
        if (p.length >= 4 && !isNaN(Number(p[0])) && !isNaN(Number(p[1])) && !isNaN(Number(p[2])) && isNaN(Number(p[3]))) {
            const sym = p[3].replace(/[^a-zA-Z]/g, '');
            if (sym.length > 0 && sym.length <= 3) {
                atoms.push({ sym, x: parseFloat(p[0]), y: parseFloat(p[1]), z: parseFloat(p[2]) });
                counts[sym] = (counts[sym] || 0) + 1;
            }
        }
    }
    const formula = Object.entries(counts).map(([el, c]) => c > 1 ? `${el}${c}` : el).join('') + ` · ${atoms.length} atoms`;
    return { atoms, bonds, formula };
}

function convertPoscarToPdb(text: string, supercellStr: string = '1 1 1'): { pdbText: string; formula: string; atoms: { sym: string; x: number; y: number; z: number }[] } {
    const lines = text.trim().split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 7) throw new Error("POSCAR file is too short.");

    const scale = parseFloat(lines[1]);
    const a = lines[2].split(/\s+/).map(Number).map(v => v * scale);
    const b = lines[3].split(/\s+/).map(Number).map(v => v * scale);
    const c = lines[4].split(/\s+/).map(Number).map(v => v * scale);

    let elements: string[] = [];
    let counts: number[] = [];
    let lineIdx = 5;

    const line5Tokens = lines[5].split(/\s+/);
    if (isNaN(Number(line5Tokens[0]))) {
        elements = line5Tokens;
        counts = lines[6].split(/\s+/).map(Number);
        lineIdx = 7;
    } else {
        counts = line5Tokens.map(Number);
        elements = counts.map((_, i) => `X${i + 1}`);
        lineIdx = 6;
    }

    if (lines[lineIdx].toLowerCase().startsWith('s')) lineIdx++;

    const coordMode = lines[lineIdx].toLowerCase();
    const isDirect = coordMode.startsWith('d') || coordMode.startsWith('f');
    lineIdx++;

    const totalAtoms = counts.reduce((acc, v) => acc + v, 0);
    const atomSymbols: string[] = [];
    elements.forEach((el, i) => {
        for (let j = 0; j < (counts[i] || 0); j++) atomSymbols.push(el);
    });

    const dims = supercellStr.trim().split(/\s+/).map(Number);
    const nx = Math.max(1, dims[0] || 1);
    const ny = Math.max(1, dims[1] || 1);
    const nz = Math.max(1, dims[2] || 1);

    const pdb: string[] = [];
    const atoms: { sym: string; x: number; y: number; z: number }[] = [];
    let atomId = 1;

    for (let ix = 0; ix < nx; ix++) {
        for (let iy = 0; iy < ny; iy++) {
            for (let iz = 0; iz < nz; iz++) {
                for (let i = 0; i < totalAtoms && (lineIdx + i) < lines.length; i++) {
                    const parts = lines[lineIdx + i].split(/\s+/);
                    const u = parseFloat(parts[0]) + ix;
                    const v = parseFloat(parts[1]) + iy;
                    const w = parseFloat(parts[2]) + iz;

                    let x = u, y = v, z = w;
                    if (isDirect) {
                        x = u * a[0] + v * b[0] + w * c[0];
                        y = u * a[1] + v * b[1] + w * c[1];
                        z = u * a[2] + v * b[2] + w * c[2];
                    } else {
                        x = (parseFloat(parts[0]) * scale) + (ix * a[0]) + (iy * b[0]) + (iz * c[0]);
                        y = (parseFloat(parts[1]) * scale) + (ix * a[1]) + (iy * b[1]) + (iz * c[1]);
                        z = (parseFloat(parts[2]) * scale) + (ix * a[2]) + (iy * b[2]) + (iz * c[2]);
                    }

                    const sym = atomSymbols[i] || 'C';
                    pdb.push(formatPdbRecord(atomId++, sym, x, y, z));
                    if (ix === 0 && iy === 0 && iz === 0) {
                        atoms.push({ sym, x, y, z });
                    }
                }
            }
        }
    }
    pdb.push('END');

    const formulaParts = elements.map((el, i) => `${el}${counts[i] * nx * ny * nz > 1 ? counts[i] * nx * ny * nz : ''}`).join('');
    const formula = `${formulaParts} · ${pdb.length - 1} atoms`;
    return { pdbText: pdb.join('\n'), formula, atoms };
}

function convertXyzToPdb(text: string): { pdbText: string; formula: string; atoms: { sym: string; x: number; y: number; z: number }[] } {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    const pdb: string[] = [];
    const atoms: { sym: string; x: number; y: number; z: number }[] = [];
    let modelNum = 1;
    let i = 0;
    let firstModelAtoms = 0;
    const atomCounts: Record<string, number> = {};

    while (i < lines.length) {
        if (/^\d+$/.test(lines[i])) {
            const count = parseInt(lines[i], 10);
            i++;
            if (modelNum === 1) firstModelAtoms = count;

            pdb.push(`MODEL     ${padLeft(modelNum.toString(), 4)}`);
            for (let j = 0; j < count && i + 1 < lines.length; j++) {
                i++;
                const parts = lines[i].split(/\s+/);
                const sym = parts[0]?.replace(/[^a-zA-Z]/g, '') || 'C';
                const x = parseFloat(parts[1]) || 0;
                const y = parseFloat(parts[2]) || 0;
                const z = parseFloat(parts[3]) || 0;

                if (modelNum === 1) {
                    atomCounts[sym] = (atomCounts[sym] || 0) + 1;
                    atoms.push({ sym, x, y, z });
                }
                pdb.push(formatPdbRecord(j + 1, sym, x, y, z));
            }
            pdb.push('ENDMDL');
            modelNum++;
            i++;
        } else {
            i++;
        }
    }
    pdb.push('END');

    const formulaStr = Object.entries(atomCounts).map(([el, c]) => c > 1 ? `${el}${c}` : el).join('');
    const totalModels = modelNum - 1;
    const formula = totalModels > 1 
        ? `${formulaStr} · ${firstModelAtoms} atoms · ${totalModels} frames`
        : `${formulaStr} · ${firstModelAtoms} atoms`;

    return { pdbText: pdb.join('\n'), formula, atoms };
}

function convertGaussianToPdb(text: string): { pdbText: string; formula: string; atoms: { sym: string; x: number; y: number; z: number }[] } {
    const lines = text.split(/\r?\n/).map(l => l.trim());
    let chargeMultIdx = -1;

    for (let i = 0; i < lines.length; i++) {
        if (/^[-+]?\d+\s+[-+]?\d+$/.test(lines[i])) {
            chargeMultIdx = i;
            break;
        }
    }

    if (chargeMultIdx === -1) throw new Error("Could not find charge/multiplicity line in Gaussian file.");

    const pdb: string[] = [];
    const atoms: { sym: string; x: number; y: number; z: number }[] = [];
    let atomId = 1;
    const counts: Record<string, number> = {};

    for (let i = chargeMultIdx + 1; i < lines.length; i++) {
        if (lines[i] === "") break;
        const tokens = lines[i].split(/\s+/);
        if (tokens.length >= 4 && isNaN(Number(tokens[0]))) {
            const sym = tokens[0].replace(/[^a-zA-Z]/g, '');
            const x = parseFloat(tokens[1]);
            const y = parseFloat(tokens[2]);
            const z = parseFloat(tokens[3]);
            if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
                pdb.push(formatPdbRecord(atomId++, sym, x, y, z));
                counts[sym] = (counts[sym] || 0) + 1;
                atoms.push({ sym, x, y, z });
            }
        }
    }
    pdb.push('END');

    const formulaStr = Object.entries(counts).map(([el, c]) => c > 1 ? `${el}${c}` : el).join('');
    return { pdbText: pdb.join('\n'), formula: `${formulaStr} · ${pdb.length - 1} atoms`, atoms };
}

function renderOffline2DSvg(atoms: { sym: string; x: number; y: number; z: number }[], explicitBonds?: { a1: number; a2: number; type: number }[]): string {
    if (!atoms || atoms.length === 0) {
        return `<svg viewBox="0 0 200 200" width="100%" height="100%"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#888">No structure</text></svg>`;
    }

    const displayAtoms = atoms.slice(0, 150);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    displayAtoms.forEach(a => {
        if (a.x < minX) minX = a.x;
        if (a.x > maxX) maxX = a.x;
        if (a.y < minY) minY = a.y;
        if (a.y > maxY) maxY = a.y;
    });

    const spanX = Math.max(maxX - minX, 1.0);
    const spanY = Math.max(maxY - minY, 1.0);
    const scale = 140 / Math.max(spanX, spanY);
    const pad = 24;

    const projected = displayAtoms.map(a => ({
        sym: a.sym,
        px: pad + (a.x - minX) * scale,
        py: pad + (maxY - a.y) * scale
    }));

    const viewW = spanX * scale + pad * 2;
    const viewH = spanY * scale + pad * 2;

    let svg = `<svg viewBox="0 0 ${viewW} ${viewH}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="background:#ffffff; max-height:100%;">`;

    if (explicitBonds && explicitBonds.length > 0) {
        for (const b of explicitBonds) {
            if (b.a1 < projected.length && b.a2 < projected.length) {
                const strokeWidth = b.type === 2 ? 3.5 : (b.type === 3 ? 5 : 2);
                const strokeDash = b.type === 4 ? `stroke-dasharray="3,2"` : '';
                svg += `<line x1="${projected[b.a1].px}" y1="${projected[b.a1].py}" x2="${projected[b.a2].px}" y2="${projected[b.a2].py}" stroke="#222" stroke-width="${strokeWidth}" ${strokeDash} stroke-linecap="round"/>`;
            }
        }
    } else {
        for (let i = 0; i < displayAtoms.length; i++) {
            for (let j = i + 1; j < displayAtoms.length; j++) {
                const a1 = displayAtoms[i];
                const a2 = displayAtoms[j];
                if (a1.sym === 'H' && a2.sym === 'H') continue;
                const d = Math.sqrt((a1.x - a2.x)**2 + (a1.y - a2.y)**2 + (a1.z - a2.z)**2);
                const maxBondLength = (a1.sym === 'H' || a2.sym === 'H') ? 1.25 : 1.85;
                if (d > 0.4 && d <= maxBondLength) {
                    svg += `<line x1="${projected[i].px}" y1="${projected[i].py}" x2="${projected[j].px}" y2="${projected[j].py}" stroke="#333" stroke-width="2" stroke-linecap="round"/>`;
                }
            }
        }
    }

    projected.forEach(a => {
        const info = ELEMENT_DATA[a.sym] || { color: '#888' };
        const radius = a.sym === 'H' ? 4 : 7.5;
        svg += `<circle cx="${a.px}" cy="${a.py}" r="${radius}" fill="${info.color}" stroke="#111" stroke-width="1.2"/>`;
        if (a.sym !== 'C' && a.sym !== 'H') {
            svg += `<text x="${a.px}" y="${a.py + 3}" font-size="8" font-weight="bold" font-family="sans-serif" text-anchor="middle" fill="#000">${a.sym}</text>`;
        }
    });

    svg += `</svg>`;
    return svg;
}

// =========================================================================
// 3D VIEWER POPUP MODAL (Clean single-context 3D modal)
// =========================================================================

class MoleculeModal extends Modal {
    child: MolstarRenderChild | null = null;

    constructor(app: App, private fileOrTarget: { type: 'file' | 'smiles' | 'pubchem' | 'raw_vasp'; content: string }, private title: string, private settings: ChemRender3DSettings) {
        super(app);
    }

    onOpen() {
        this.titleEl.setText(this.title);
        this.contentEl.style.height = '480px';
        this.contentEl.style.padding = '0';
        this.contentEl.style.overflow = 'hidden';

        const modalSettings: ChemRender3DSettings = {
            ...this.settings,
            viewerHeight: '100%',
            showUIPanels: false,
            showQuickToolbar: true
        };

        this.child = new MolstarRenderChild(this.contentEl, { type: this.fileOrTarget.type, content: this.fileOrTarget.content, sourcePath: '' }, this.app, modalSettings);
        this.child.onload();
    }

    onClose() {
        if (this.child) {
            this.child.onunload();
            this.child = null;
        }
        this.contentEl.empty();
    }
}

// =========================================================================
// 3D RENDER COMPONENT
// =========================================================================

class MolstarRenderChild extends MarkdownRenderChild {
    pluginInstance: any = null;
    settings: ChemRender3DSettings;
    renderData: RenderData;
    pluginApp: App;
    currentMode2D = false;
    panel2D: HTMLElement | null = null;
    parsedAtomsList: { sym: string; x: number; y: number; z: number }[] = [];
    explicitBondsList: { a1: number; a2: number; type: number }[] = [];
    clickHistory: { sym: string; x: number; y: number; z: number }[] = [];
    inspectorEl: HTMLElement | null = null;
    rootWrapper: HTMLElement | null = null;

    constructor(containerEl: HTMLElement, renderData: RenderData, pluginApp: App, settings: ChemRender3DSettings) {
        super(containerEl);
        this.renderData = renderData;
        this.pluginApp = pluginApp;
        this.settings = settings;
    }

    async onload() {
        const rootWrapper = this.containerEl.createDiv({ cls: 'chem3d-root-wrapper' });
        this.rootWrapper = rootWrapper;
        rootWrapper.style.position = 'relative';
        rootWrapper.style.width = this.renderData.width || '100%';
        rootWrapper.style.height = this.renderData.height || this.settings.viewerHeight;
        rootWrapper.style.maxWidth = '100%';
        rootWrapper.style.borderRadius = '8px';
        rootWrapper.style.overflow = 'hidden';
        rootWrapper.style.border = '1px solid var(--background-modifier-border)';

        const viewerContainer = rootWrapper.createDiv({ cls: 'molstar-viewer-container' });
        viewerContainer.style.width = '100%';
        viewerContainer.style.height = '100%';
        viewerContainer.style.position = 'absolute';

        const panel2D = rootWrapper.createDiv({ cls: 'chem3d-2d-panel' });
        this.panel2D = panel2D;
        Object.assign(panel2D.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            background: '#ffffff',
            display: 'none',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: '10'
        });

        const inspectorBadge = rootWrapper.createDiv({ cls: 'chem3d-inspector-badge' });
        this.inspectorEl = inspectorBadge;
        Object.assign(inspectorBadge.style, {
            position: 'absolute',
            bottom: '6px',
            right: '8px',
            background: 'rgba(28, 28, 30, 0.85)',
            backdropFilter: 'blur(4px)',
            color: '#a1a1aa',
            fontSize: '11px',
            padding: '3px 8px',
            borderRadius: '4px',
            zIndex: '5',
            fontFamily: 'monospace',
            pointerEvents: 'none'
        });
        inspectorBadge.textContent = 'Hover/Click atoms to inspect';

        if (this.settings.preventAppClick) {
            const stopClick = (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
            };
            rootWrapper.addEventListener('click', stopClick);
            rootWrapper.addEventListener('auxclick', stopClick);
        }

        try {
            this.pluginInstance = await createPluginUI({
                target: viewerContainer,
                render: renderReact18,
                layoutIsExpanded: false,
                layoutShowControls: this.settings.showUIPanels,
                layoutShowRemoteState: false,
                layoutShowSequence: true,
                layoutShowLog: false,
                layoutShowLeftPanel: this.settings.showUIPanels,
            });

            let rawStringData = "";
            let parsedFormat = "";
            let formulaLabel = "";
            let sessionFile: TFile | null = null;

            if (this.renderData.type === 'raw_vasp') {
                const supercell = this.renderData.supercell || this.settings.poscarSupercell;
                const res = convertPoscarToPdb(this.renderData.content, supercell);
                rawStringData = res.pdbText;
                formulaLabel = res.formula;
                this.parsedAtomsList = res.atoms;
                parsedFormat = 'pdb';

            } else if (this.renderData.type === 'file') {
                const file = resolveVaultFile(this.pluginApp, this.renderData.content, this.renderData.sourcePath);
                if (!file) {
                    const err = this.containerEl.createDiv({ cls: "color-red", text: `ChemRender3D: File not found: ${this.renderData.content}` });
                    err.style.padding = '8px';
                    return;
                }

                const detected = detectFormat(file);
                if (!detected) {
                    const err = this.containerEl.createDiv({ cls: "color-red", text: `ChemRender3D: Unsupported format for ${file.name}` });
                    err.style.padding = '8px';
                    return;
                }

                if (isSessionFormat(detected)) {
                    // .molx is a zip archive, so it must never go through vault.read().
                    sessionFile = file;
                    parsedFormat = detected;
                    formulaLabel = file.basename;
                } else {
                    const fileText = await this.pluginApp.vault.read(file);

                    if (detected === 'mol' || detected === 'sdf') {
                        const res = parseMolFile(fileText);
                        this.parsedAtomsList = res.atoms;
                        this.explicitBondsList = res.bonds;
                        formulaLabel = res.formula;
                        rawStringData = fileText;
                        parsedFormat = detected;
                    } else if (detected === 'vasp') {
                        const supercell = this.renderData.supercell || this.settings.poscarSupercell;
                        const res = convertPoscarToPdb(fileText, supercell);
                        rawStringData = res.pdbText;
                        formulaLabel = res.formula;
                        this.parsedAtomsList = res.atoms;
                        parsedFormat = 'pdb';
                    } else if (detected === 'xyz' || detected === 'xdatcar') {
                        const res = convertXyzToPdb(fileText);
                        rawStringData = res.pdbText;
                        formulaLabel = res.formula;
                        this.parsedAtomsList = res.atoms;
                        parsedFormat = 'pdb';
                    } else if (detected === 'gaussian' || detected === 'qe') {
                        const res = convertGaussianToPdb(fileText);
                        rawStringData = res.pdbText;
                        formulaLabel = res.formula;
                        this.parsedAtomsList = res.atoms;
                        parsedFormat = 'pdb';
                    } else {
                        rawStringData = fileText;
                        parsedFormat = detected;
                    }
                }

            } else if (this.renderData.type === 'smiles' || this.renderData.type === 'pubchem') {
                const query = this.renderData.content.trim();
                try {
                    const isCid = /^\d+$/.test(query);
                    const url = isCid 
                        ? `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${query}/SDF?record_type=3d`
                        : `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(query)}/SDF?record_type=3d`;
                    const res = await requestUrl({ url });
                    rawStringData = res.text;
                    parsedFormat = 'sdf';
                    formulaLabel = query.toUpperCase();
                    const parsed = parseMolFile(rawStringData);
                    this.parsedAtomsList = parsed.atoms;
                    this.explicitBondsList = parsed.bonds;
                } catch {
                    const response = await requestUrl({
                        url: `https://cactus.nci.nih.gov/chemical/structure/${encodeURIComponent(query)}/file?format=sdf&get3d=true`
                    });
                    rawStringData = response.text;
                    parsedFormat = 'sdf';
                    formulaLabel = query;
                    const parsed = parseMolFile(rawStringData);
                    this.parsedAtomsList = parsed.atoms;
                    this.explicitBondsList = parsed.bonds;
                }

            } else if (this.renderData.type === 'pdb') {
                const response = await requestUrl({
                    url: `https://files.rcsb.org/download/${encodeURIComponent(this.renderData.content.toUpperCase())}.cif`
                });
                rawStringData = response.text;
                parsedFormat = 'mmcif';
                formulaLabel = `PDB: ${this.renderData.content.toUpperCase()}`;

            } else if (this.renderData.type === 'afdb') {
                const uniprotId = this.renderData.content.toUpperCase();
                const metaRes = await requestUrl({
                    url: `https://alphafold.ebi.ac.uk/api/prediction/${uniprotId}`
                });
                const data = metaRes.json;
                if (!Array.isArray(data) || !data[0] || !data[0].cifUrl) {
                    throw new Error(`AlphaFold prediction not found for UniProt ID: ${uniprotId}`);
                }
                const cifRes = await requestUrl({ url: data[0].cifUrl });
                rawStringData = cifRes.text;
                parsedFormat = 'mmcif';
                formulaLabel = `AlphaFold: ${uniprotId}`;
            }

            if (sessionFile) {
                await this.loadSession(sessionFile);
                this.attachInteractions();
            } else if (parsedFormat === 'cube') {
                const data = await this.pluginInstance.builders.data.rawData({ data: rawStringData });
                const volume = await this.pluginInstance.builders.volume.parseVolume(data, 'cube');
                await this.pluginInstance.builders.volume.representation.addIsosurface(volume, {
                    alpha: 0.8,
                    isoValue: { kind: 'absolute', value: 0.02 },
                    colorTheme: { name: 'uniform', value: Color(0x3366ff) }
                });
                await this.pluginInstance.builders.volume.representation.addIsosurface(volume, {
                    alpha: 0.8,
                    isoValue: { kind: 'absolute', value: -0.02 },
                    colorTheme: { name: 'uniform', value: Color(0xff3333) }
                });
            } else {
                const data = await this.pluginInstance.builders.data.rawData({ data: rawStringData });
                const trajectory = await this.pluginInstance.builders.structure.parseTrajectory(data, parsedFormat);
                const model = await this.pluginInstance.builders.structure.createModel(trajectory);
                const structure = await this.pluginInstance.builders.structure.createStructure(model);

                await this.pluginInstance.builders.structure.representation.applyPreset(structure, this.settings.defaultPreset);

                // Autoplay trajectories (vibrations, XDATCAR)
                if (this.settings.autoPlayTrajectory && (parsedFormat === 'pdb' || parsedFormat === 'xyz')) {
                    setTimeout(async () => {
                        try {
                            const animMgr = this.pluginInstance?.managers?.animation;
                            if (animMgr) {
                                const anim = animMgr.animations.find((a: any) => a.name === 'model-index' || a.id === 'model-index') || animMgr.animations[0];
                                if (anim) {
                                    await animMgr.play(anim, { mode: { name: 'loop', params: {} }, maxFPS: 20 });
                                }
                            }
                        } catch (_) {}
                    }, 350); 
                }

                // Minimum focus distance of 10 Å keeps small molecules clearly visible and not clipped
                setTimeout(() => {
                    this.pluginInstance?.canvas3d?.requestCameraReset({ durationMs: 0 });
                }, 100);

                this.attachInteractions();
            }

            const isDark = document.body.classList.contains('theme-dark');
            const bgColor = isDark ? Color(0x1e1e1e) : Color(0xffffff); 
            
            if (this.pluginInstance.canvas3d) {
                this.pluginInstance.canvas3d.setProps({
                    // A session restores the background it was saved with; overriding it
                    // would stop the viewer from reproducing what the author set up.
                    ...(sessionFile ? {} : { renderer: { backgroundColor: bgColor } }),
                    pixelScale: this.settings.maxPixelRatio
                });

                if (this.settings.autoSpinCamera) {
                    this.pluginInstance.canvas3d.setProps({
                        trackball: { animate: { name: 'spin', params: { speed: 1 } } }
                    });
                }
            }

            // Chemical Formula Badge
            if (formulaLabel) {
                const badge = viewerContainer.createDiv({ text: formulaLabel });
                Object.assign(badge.style, {
                    position: 'absolute',
                    bottom: '6px',
                    left: '8px',
                    background: 'rgba(28, 28, 30, 0.75)',
                    backdropFilter: 'blur(4px)',
                    color: '#e4e4e7',
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    pointerEvents: 'none',
                    zIndex: '5',
                    fontFamily: 'monospace'
                });
            }

            // Minimalist 3-Icon Toolbar: Snapshot, 2D Vector Toggle, and Spin
            if (this.settings.showQuickToolbar) {
                const toolbar = viewerContainer.createDiv({ cls: 'chem3d-hud-minimal' });
                Object.assign(toolbar.style, {
                    position: 'absolute',
                    top: '8px',
                    left: '8px',
                    display: 'flex',
                    gap: '3px',
                    zIndex: '15',
                    background: 'rgba(28, 28, 30, 0.85)',
                    backdropFilter: 'blur(6px)',
                    padding: '3px 4px',
                    borderRadius: '6px',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.25)'
                });

                const createBtn = (svgPath: string, tooltip: string, onClick: () => void) => {
                    const btn = toolbar.createEl('button');
                    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgPath}</svg>`;
                    btn.title = tooltip;
                    Object.assign(btn.style, {
                        background: 'transparent',
                        border: 'none',
                        color: '#d4d4d8',
                        padding: '4px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '4px'
                    });
                    btn.onmouseenter = () => { btn.style.background = 'rgba(255,255,255,0.18)'; btn.style.color = '#fff'; };
                    btn.onmouseleave = () => { btn.style.background = 'transparent'; btn.style.color = '#d4d4d8'; };
                    btn.onclick = (e) => { e.stopPropagation(); onClick(); };
                    return btn;
                };

                // 1. Snapshot figure
                createBtn(
                    `<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>`,
                    'Copy Figure to Clipboard',
                    () => {
                        const canvas = viewerContainer.querySelector('canvas') as HTMLCanvasElement;
                        if (!canvas) return;
                        canvas.toBlob(async (blob) => {
                            if (blob && navigator.clipboard) {
                                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                                new Notice('Figure snapshot copied to clipboard!');
                            }
                        });
                    }
                );

                // 2. Offline 2D Vector Diagram Toggle
                createBtn(
                    `<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 7h10v10H7z"/>`,
                    'Toggle 2D Skeletal Diagram',
                    () => {
                        this.currentMode2D = !this.currentMode2D;
                        if (this.currentMode2D && this.panel2D) {
                            this.panel2D.empty();
                            const svgContainer = this.panel2D.createDiv({ style: 'width:80%; height:80%; display:flex; align-items:center; justify-content:center;' });
                            svgContainer.innerHTML = renderOffline2DSvg(this.parsedAtomsList, this.explicitBondsList);
                            this.panel2D.style.display = 'flex';
                        } else if (this.panel2D) {
                            this.panel2D.style.display = 'none';
                        }
                    }
                );

                // 3. Spin toggle
                let spinning = this.settings.autoSpinCamera;
                createBtn(
                    `<path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>`,
                    'Toggle Auto-Spin',
                    () => {
                        spinning = !spinning;
                        this.pluginInstance?.canvas3d?.setProps({
                            trackball: { animate: spinning ? { name: 'spin', params: { speed: 1 } } : { name: 'off' } }
                        });
                    }
                );

                // 4. Snapshot stepper - a session can hold a sequence of states, and
                // without this only the one it opened on would ever be visible.
                const snapshots = this.pluginInstance?.managers?.snapshot;
                const snapshotCount = sessionFile ? (snapshots?.state?.entries?.size ?? 0) : 0;
                if (snapshotCount > 1) {
                    const counter = document.createElement('div');
                    Object.assign(counter.style, {
                        color: '#d4d4d8',
                        fontSize: '11px',
                        fontFamily: 'monospace',
                        display: 'flex',
                        alignItems: 'center',
                        padding: '0 3px',
                        userSelect: 'none'
                    });

                    const updateCounter = () => {
                        const current = snapshots.current;
                        const index = current ? snapshots.getIndex(current) : 0;
                        counter.textContent = `${index + 1}/${snapshotCount}`;
                    };

                    const step = async (dir: -1 | 1) => {
                        try {
                            await snapshots.applyNext(dir);
                        } catch (_) {}
                        updateCounter();
                    };

                    createBtn(`<path d="M15 18l-6-6 6-6"/>`, 'Previous snapshot', () => { void step(-1); });
                    toolbar.appendChild(counter);
                    createBtn(`<path d="M9 18l6-6-6-6"/>`, 'Next snapshot', () => { void step(1); });
                    updateCounter();
                }
            }

        } catch (err) {
            const errDiv = this.containerEl.createDiv({ cls: "color-red", text: `ChemRender3D Error: ${err.message || err}` });
            errDiv.style.padding = '8px';
        }
    }

    /**
     * Apply a new embed size to a viewer that is already running. Rebuilding the Mol*
     * instance for a size change would drop the WebGL context and the loaded structure,
     * which is both slow and visibly disruptive while the size is being typed.
     */
    applySize(size: EmbedSize) {
        this.renderData.width = size.width;
        this.renderData.height = size.height;

        if (!this.rootWrapper) return;
        this.rootWrapper.style.width = size.width || '100%';
        this.rootWrapper.style.height = size.height || this.settings.viewerHeight;

        // Mol* has a ResizeObserver on the canvas, but it is debounced; ask directly.
        try {
            this.pluginInstance?.handleResize();
        } catch (_) {}
    }

    /**
     * Load a saved Mol* session (.molx zip / .molj JSON) straight into the plugin state.
     * Mol*'s own `open` swallows read errors and only logs them, so success is detected
     * from the `opened` event rather than from the absence of a throw.
     */
    async loadSession(file: TFile) {
        const buffer = await this.pluginApp.vault.readBinary(file);
        const sessionBlob = new File([buffer], file.name);

        let opened = false;
        const sub = this.pluginInstance.managers.snapshot.events.opened.subscribe(() => { opened = true; });
        try {
            await this.pluginInstance.managers.snapshot.open(sessionBlob);
        } finally {
            sub.unsubscribe();
        }

        if (!opened) throw new Error(`Could not read Mol* session "${file.name}"`);
    }

    attachInteractions() {
        // Live Hover Feedback
        this.pluginInstance.behaviors.interaction.hover.subscribe((event: any) => {
            const loci = event.current.loci;
            if (loci && loci.kind === 'element-loci') {
                try {
                    const unit = loci.elements[0]?.unit;
                    const idx = loci.elements[0]?.indices[0];
                    if (unit && idx !== undefined && this.inspectorEl) {
                        const sym = unit.model.atomicHierarchy.derived.atoms.type_symbol.value(idx);
                        const x = unit.model.atomicConformation.x[idx];
                        const y = unit.model.atomicConformation.y[idx];
                        const z = unit.model.atomicConformation.z[idx];
                        const info = ELEMENT_DATA[sym] || { name: sym, number: '?' };
                        this.inspectorEl.style.color = '#38bdf8';
                        this.inspectorEl.textContent = `🔍 ${info.name} (${sym} #${info.number}) · [${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}] Å`;
                    }
                } catch (_) {}
            }
        });

        // Interactive Atom, Distance & Angle Measurement Tool
        this.pluginInstance.behaviors.interaction.click.subscribe((event: any) => {
            const loci = event.current.loci;
            if (loci && loci.kind === 'element-loci') {
                try {
                    const unit = loci.elements[0]?.unit;
                    const idx = loci.elements[0]?.indices[0];
                    if (unit && idx !== undefined) {
                        const sym = unit.model.atomicHierarchy.derived.atoms.type_symbol.value(idx);
                        const x = unit.model.atomicConformation.x[idx];
                        const y = unit.model.atomicConformation.y[idx];
                        const z = unit.model.atomicConformation.z[idx];

                        this.clickHistory.push({ sym, x, y, z });

                        if (this.clickHistory.length === 1 && this.inspectorEl) {
                            this.inspectorEl.style.color = '#fde047';
                            this.inspectorEl.textContent = `📍 Selected ${sym} · Click next atom to measure`;
                            new Notice(`Selected ${sym} [${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}]`);
                        } else if (this.clickHistory.length === 2 && this.inspectorEl) {
                            const p1 = this.clickHistory[0], p2 = this.clickHistory[1];
                            const dist = Math.sqrt((p1.x - p2.x)**2 + (p1.y - p2.y)**2 + (p1.z - p2.z)**2);
                            this.inspectorEl.style.color = '#4ade80';
                            this.inspectorEl.textContent = `📏 Distance (${p1.sym}—${p2.sym}): ${dist.toFixed(3)} Å`;
                            new Notice(`📏 Distance (${p1.sym}—${p2.sym}): ${dist.toFixed(3)} Å\nClick a 3rd atom for bond angle`);
                        } else if (this.clickHistory.length === 3 && this.inspectorEl) {
                            const p1 = this.clickHistory[0], p2 = this.clickHistory[1], p3 = this.clickHistory[2];
                            const v1 = { x: p1.x - p2.x, y: p1.y - p2.y, z: p1.z - p2.z };
                            const v2 = { x: p3.x - p2.x, y: p3.y - p2.y, z: p3.z - p2.z };
                            const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
                            const len1 = Math.sqrt(v1.x**2 + v1.y**2 + v1.z**2);
                            const len2 = Math.sqrt(v2.x**2 + v2.y**2 + v2.z**2);
                            const angle = Math.acos(Math.max(-1, Math.min(1, dot / (len1 * len2)))) * (180 / Math.PI);
                            this.inspectorEl.style.color = '#c084fc';
                            this.inspectorEl.textContent = `📐 Angle (${p1.sym}—${p2.sym}—${p3.sym}): ${angle.toFixed(1)}°`;
                            new Notice(`📐 Angle (${p1.sym}—${p2.sym}—${p3.sym}): ${angle.toFixed(1)}°`);
                            this.clickHistory = [];
                        }
                    }
                } catch (_) {}
            }
        });
    }

    onunload() {
        if (this.pluginInstance) {
            try {
                const canvas = this.containerEl.querySelector('canvas');
                if (canvas) {
                    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
                    gl?.getExtension('WEBGL_lose_context')?.loseContext();
                }
                this.pluginInstance.dispose();
            } catch (_) {}
            this.pluginInstance = null;
        }
    }
}

// =========================================================================
// 2D STANDALONE CARD COMPONENT (`2dmol`)
// =========================================================================

class Molstar2DRenderChild extends MarkdownRenderChild {
    constructor(
        containerEl: HTMLElement,
        private renderData: RenderData,
        private pluginApp: App,
        private settings: ChemRender3DSettings
    ) {
        super(containerEl);
    }

    async onload() {
        const card = this.containerEl.createDiv({
            style: `width: ${this.renderData.width || '220px'}; max-width: 100%; background: var(--background-secondary); border-radius: 8px; border: 1px solid var(--background-modifier-border); padding: 8px; cursor: pointer; display: flex; flex-direction: column; gap: 6px; transition: transform 0.15s, border-color 0.15s; margin: 10px 0;`
        });

        card.onmouseenter = () => { card.style.borderColor = 'var(--interactive-accent)'; card.style.transform = 'translateY(-2px)'; };
        card.onmouseleave = () => { card.style.borderColor = 'var(--background-modifier-border)'; card.style.transform = 'translateY(0)'; };

        const titleText = this.renderData.content.replace(/^!?\[\[/, '').replace(/\]\]$/, '').split('/').pop() || 'Structure';
        const titleEl = card.createDiv({ text: titleText, style: 'font-size: 0.85em; font-weight: bold; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' });
        titleEl.title = titleText;

        const previewBox = card.createDiv({ style: `height: ${this.renderData.height || '140px'}; width: 100%; display: flex; align-items: center; justify-content: center; background: #ffffff; border-radius: 6px; overflow: hidden;` });
        const badgeEl = card.createDiv({ style: 'font-size: 10px; color: var(--text-muted); text-align: center; font-family: monospace;' });

        let rawText = '';
        let detected = '';

        if (this.renderData.type === 'file') {
            const file = resolveVaultFile(this.pluginApp, this.renderData.content, this.renderData.sourcePath);
            if (file) {
                detected = detectFormat(file) || '';
                // A session holds no plain atom list to flatten, and .molx is binary.
                if (!isSessionFormat(detected)) {
                    rawText = await this.pluginApp.vault.read(file);
                }
            }
        } else if (this.renderData.type === 'raw_vasp') {
            rawText = this.renderData.content;
            detected = 'vasp';
        } else if (this.renderData.type === 'smiles' || this.renderData.type === 'pubchem') {
            const query = this.renderData.content.trim();
            try {
                const res = await requestUrl({ url: `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(query)}/SDF?record_type=3d` });
                rawText = res.text;
                detected = 'sdf';
            } catch {
                try {
                    const res = await requestUrl({ url: `https://cactus.nci.nih.gov/chemical/structure/${encodeURIComponent(query)}/file?format=sdf&get3d=true` });
                    rawText = res.text;
                    detected = 'sdf';
                } catch (_) {}
            }
        }

        if (rawText) {
            let atoms: { sym: string; x: number; y: number; z: number }[] = [];
            let bonds: { a1: number; a2: number; type: number }[] = [];
            let formula = '';

            if (detected === 'mol' || detected === 'sdf') {
                const res = parseMolFile(rawText);
                atoms = res.atoms;
                bonds = res.bonds;
                formula = res.formula;
            } else if (detected === 'vasp') {
                const res = convertPoscarToPdb(rawText);
                atoms = res.atoms;
                formula = res.formula;
            } else if (detected === 'xyz' || detected === 'xdatcar') {
                const res = convertXyzToPdb(rawText);
                atoms = res.atoms;
                formula = res.formula;
            } else if (detected === 'gaussian' || detected === 'qe') {
                const res = convertGaussianToPdb(rawText);
                atoms = res.atoms;
                formula = res.formula;
            }

            previewBox.innerHTML = renderOffline2DSvg(atoms, bonds);
            badgeEl.setText(formula);
        } else {
            const message = isSessionFormat(detected) ? 'Mol* session — open in 3D' : 'Preview unavailable';
            previewBox.innerHTML = `<span style="font-size:10px; color:#888;">${message}</span>`;
        }

        card.onclick = (e) => {
            e.stopPropagation();
            new MoleculeModal(this.pluginApp, { type: this.renderData.type, content: this.renderData.content }, titleText, this.settings).open();
        };
    }
}

// =========================================================================
// MAIN PLUGIN CLASS
// =========================================================================

export default class ChemRender3DPlugin extends Plugin {
    settings: ChemRender3DSettings;

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new ChemRender3DSettingTab(this.app, this));

        // 1. Interactive 3D Viewer Codeblock (`3dmol`)
        this.registerMarkdownCodeBlockProcessor('3dmol', (source, el, ctx) => {
            const trimmed = source.trim();

            if (isRawVasp(trimmed)) {
                ctx.addChild(new MolstarRenderChild(el, { type: 'raw_vasp', content: trimmed, sourcePath: ctx.sourcePath }, this.app, this.settings));
                return;
            }

            const filenameMatch = trimmed.match(/^!?\[\[(.*?)\]\]$/);
            if (filenameMatch && filenameMatch[1]) {
                const { path: clean, size } = parseEmbedLink(filenameMatch[1]);
                ctx.addChild(new MolstarRenderChild(el, { type: 'file', content: clean, sourcePath: ctx.sourcePath, ...size }, this.app, this.settings));
                return;
            }

            if (trimmed.includes(':') && trimmed.includes('\n')) {
                const lines = trimmed.split('\n');
                let target = '';
                let type: any = 'file';
                let supercell = undefined;
                let size: EmbedSize = {};

                for (const line of lines) {
                    const idx = line.indexOf(':');
                    if (idx === -1) continue;
                    const k = line.slice(0, idx).trim().toLowerCase();
                    const v = line.slice(idx + 1).trim();
                    if (['file', 'pdb', 'afdb', 'pubchem', 'smiles'].includes(k)) {
                        type = k;
                        target = v.replace(/^!?\[\[/, '').replace(/\]\]$/, '');
                        // Only a vault link can carry a size suffix; a SMILES string may
                        // legitimately contain '#', which parseEmbedLink would cut off.
                        if (k === 'file') {
                            const parsed = parseEmbedLink(target);
                            target = parsed.path;
                            size = parsed.size;
                        }
                    } else if (k === 'supercell') {
                        supercell = v;
                    }
                }
                if (target) {
                    ctx.addChild(new MolstarRenderChild(el, { type, content: target, sourcePath: ctx.sourcePath, supercell, ...size }, this.app, this.settings));
                    return;
                }
            }

            const pdbMatch = trimmed.match(/^(?:pdb|rcsb):\s*([a-zA-Z0-9]+)$/i);
            if (pdbMatch) {
                ctx.addChild(new MolstarRenderChild(el, { type: 'pdb', content: pdbMatch[1].trim(), sourcePath: ctx.sourcePath }, this.app, this.settings));
                return;
            }

            const afMatch = trimmed.match(/^(?:afdb|af):\s*([a-zA-Z0-9_-]+)$/i);
            if (afMatch) {
                ctx.addChild(new MolstarRenderChild(el, { type: 'afdb', content: afMatch[1].trim(), sourcePath: ctx.sourcePath }, this.app, this.settings));
                return;
            }

            const pubchemMatch = trimmed.match(/^(?:pubchem|cid):\s*(.+)$/i);
            if (pubchemMatch) {
                ctx.addChild(new MolstarRenderChild(el, { type: 'pubchem', content: pubchemMatch[1].trim(), sourcePath: ctx.sourcePath }, this.app, this.settings));
                return;
            }

            if (/^[0-9][a-zA-Z0-9]{3}$/.test(trimmed)) {
                ctx.addChild(new MolstarRenderChild(el, { type: 'pdb', content: trimmed, sourcePath: ctx.sourcePath }, this.app, this.settings));
                return;
            }

            const isSmiles = /[=\#\(\)\[\]\\\/@]/.test(trimmed);
            const renderType = isSmiles ? 'smiles' : 'pubchem';
            ctx.addChild(new MolstarRenderChild(el, { type: renderType, content: trimmed, sourcePath: ctx.sourcePath }, this.app, this.settings));
        });

        // 2. Standalone 2D Codeblock Processor (`2dmol`) - Click to Open 3D
        this.registerMarkdownCodeBlockProcessor('2dmol', (source, el, ctx) => {
            const trimmed = source.trim();

            if (isRawVasp(trimmed)) {
                ctx.addChild(new Molstar2DRenderChild(el, { type: 'raw_vasp', content: trimmed, sourcePath: ctx.sourcePath }, this.app, this.settings));
                return;
            }

            const filenameMatch = trimmed.match(/^!?\[\[(.*?)\]\]$/);
            if (filenameMatch && filenameMatch[1]) {
                const { path: clean, size } = parseEmbedLink(filenameMatch[1]);
                ctx.addChild(new Molstar2DRenderChild(el, { type: 'file', content: clean, sourcePath: ctx.sourcePath, ...size }, this.app, this.settings));
                return;
            }

            const isSmiles = /[=\#\(\)\[\]\\\/@]/.test(trimmed);
            const renderType = isSmiles ? 'smiles' : 'pubchem';
            ctx.addChild(new Molstar2DRenderChild(el, { type: renderType, content: trimmed, sourcePath: ctx.sourcePath }, this.app, this.settings));
        });

        // 3. Classic Interactive 3D Grid Processor (`3dmol-grid`)
        this.registerMarkdownCodeBlockProcessor('3dmol-grid', async (source, el, ctx) => {
            let folderPath = '';
            let parsedCols: number | null = null;

            try {
                const yaml = parseYaml(source);
                if (yaml && typeof yaml === 'object') {
                    if (yaml.folder) folderPath = String(yaml.folder).trim();
                    const c = parseInt(yaml.columns || yaml.column || yaml.cols || yaml.col, 10);
                    if (!isNaN(c) && c > 0) parsedCols = c;
                }
            } catch (_) {}

            if (!folderPath) {
                const folderMatch = source.match(/folder:\s*([^\n\r]+)/i);
                if (folderMatch) folderPath = folderMatch[1].trim().replace(/^['"]|['"]$/g, '');
            }

            if (parsedCols === null) {
                const colMatch = source.match(/(?:columns?|cols?):\s*(\d+)/i);
                if (colMatch) {
                    const c = parseInt(colMatch[1], 10);
                    if (!isNaN(c) && c > 0) parsedCols = c;
                }
            }

            const cols = Math.max(1, Math.min(6, parsedCols || this.settings.defaultGridColumns || 3));

            if (!folderPath) return;
            const folder = this.app.vault.getAbstractFileByPath(folderPath);
            if (!folder || !('children' in folder)) return;

            const files = (folder as any).children
                .filter((f: any) => f instanceof TFile && detectFormat(f) !== null)
                .slice(0, this.settings.gridMaxFiles);

            if (files.length === 0) {
                el.createDiv({ text: `No supported 3D structures found in "${folderPath}".` });
                return;
            }

            const gridContainer = el.createDiv({
                style: `display: grid; grid-template-columns: repeat(${cols}, minmax(0, 1fr)); gap: 12px; margin-top: 10px; width: 100%;`
            });
            const gridSettings: ChemRender3DSettings = { ...this.settings, showUIPanels: false, showQuickToolbar: false, autoSpinCamera: false, viewerHeight: '200px' };

            for (const file of files) {
                const cell = gridContainer.createDiv({ style: 'display: flex; flex-direction: column; gap: 4px; background: var(--background-secondary); padding: 6px; border-radius: 8px; min-width: 0; overflow: hidden;' });
                cell.createDiv({ text: file.name, style: 'font-size: 0.85em; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center;' });
                const viewerEl = cell.createDiv();
                ctx.addChild(new MolstarRenderChild(viewerEl, { type: 'file', content: file.path, sourcePath: ctx.sourcePath }, this.app, gridSettings));
            }
        });

        // 4. Lightweight 2D Vector Gallery (`2d-grid`) with Column Configuration
        this.registerMarkdownCodeBlockProcessor('2d-grid', async (source, el, ctx) => {
            let folderPath = '';
            let parsedCols: number | null = null;

            try {
                const yaml = parseYaml(source);
                if (yaml && typeof yaml === 'object') {
                    if (yaml.folder) folderPath = String(yaml.folder).trim();
                    const c = parseInt(yaml.columns || yaml.column || yaml.cols || yaml.col, 10);
                    if (!isNaN(c) && c > 0) parsedCols = c;
                }
            } catch (_) {}

            if (!folderPath) {
                const folderMatch = source.match(/folder:\s*([^\n\r]+)/i);
                if (folderMatch) folderPath = folderMatch[1].trim().replace(/^['"]|['"]$/g, '');
            }

            if (parsedCols === null) {
                const colMatch = source.match(/(?:columns?|cols?):\s*(\d+)/i);
                if (colMatch) {
                    const c = parseInt(colMatch[1], 10);
                    if (!isNaN(c) && c > 0) parsedCols = c;
                }
            }

            const cols = Math.max(1, Math.min(6, parsedCols || this.settings.defaultGridColumns || 3));

            if (!folderPath) return;
            const folder = this.app.vault.getAbstractFileByPath(folderPath);
            if (!folder || !('children' in folder)) return;

            const files = (folder as any).children
                .filter((f: any) => f instanceof TFile && detectFormat(f) !== null && !isSessionFormat(detectFormat(f)))
                .slice(0, this.settings.gridMaxFiles);

            if (files.length === 0) {
                el.createDiv({ text: `No supported structures found in "${folderPath}".` });
                return;
            }

            const gridContainer = el.createDiv({
                style: `display: grid; grid-template-columns: repeat(${cols}, minmax(0, 1fr)); gap: 10px; margin-top: 10px; width: 100%;`
            });

            for (const file of files) {
                const cell = gridContainer.createDiv({
                    style: 'display:flex; flex-direction:column; gap:4px; background:var(--background-secondary); padding:6px; border-radius:8px; border:1px solid var(--background-modifier-border); cursor:pointer; min-width:0; overflow:hidden; transition:transform 0.15s, border-color 0.15s;'
                });

                cell.onmouseenter = () => { cell.style.borderColor = 'var(--interactive-accent)'; cell.style.transform = 'translateY(-2px)'; };
                cell.onmouseleave = () => { cell.style.borderColor = 'var(--background-modifier-border)'; cell.style.transform = 'translateY(0)'; };

                const title = cell.createDiv({ text: file.name, style: 'text-align:center; font-size:0.8em; font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;' });
                title.title = file.name;

                const previewBoxHeight = cols >= 4 ? '100px' : (cols === 3 ? '120px' : '150px');
                const previewBox = cell.createDiv({ style: `height:${previewBoxHeight}; width:100%; display:flex; align-items:center; justify-content:center; background:#ffffff; border-radius:6px; overflow:hidden;` });

                this.app.vault.read(file).then(fileText => {
                    try {
                        const detected = detectFormat(file);
                        let atoms: { sym: string; x: number; y: number; z: number }[] = [];
                        let bonds: { a1: number; a2: number; type: number }[] = [];
                        let formula = '';

                        if (detected === 'mol' || detected === 'sdf') {
                            const res = parseMolFile(fileText);
                            atoms = res.atoms;
                            bonds = res.bonds;
                            formula = res.formula;
                        } else if (detected === 'vasp') {
                            const res = convertPoscarToPdb(fileText);
                            atoms = res.atoms;
                            formula = res.formula;
                        } else if (detected === 'xyz' || detected === 'xdatcar') {
                            const res = convertXyzToPdb(fileText);
                            atoms = res.atoms;
                            formula = res.formula;
                        } else if (detected === 'gaussian' || detected === 'qe') {
                            const res = convertGaussianToPdb(fileText);
                            atoms = res.atoms;
                            formula = res.formula;
                        }

                        previewBox.innerHTML = renderOffline2DSvg(atoms, bonds);

                        if (formula) {
                            const badge = cell.createDiv({ text: formula, style: 'font-size:9.5px; color:var(--text-muted); text-align:center; font-family:monospace;' });
                            badge.title = formula;
                        }
                    } catch (_) {
                        previewBox.innerHTML = `<span style="font-size:10px; color:#888;">Unavailable</span>`;
                    }
                });

                cell.onclick = (e) => {
                    e.stopPropagation();
                    new MoleculeModal(this.app, { type: 'file', content: file.path }, file.name, this.settings).open();
                };
            }
        });

        // 5. Native ![[file.ext]] Embed Processor
        this.registerMarkdownPostProcessor((element, context) => {
            const embeds = Array.from(element.querySelectorAll('.internal-embed'));
            if (element.classList?.contains('internal-embed')) embeds.push(element);
            
            embeds.forEach((embed) => {
                const src = embed.getAttribute('src');
                if (!src) return;
                const { path: cleanSrc } = parseEmbedLink(src);
                const size = parseEmbedElementSize(embed, src);

                if (isFileSupported(cleanSrc, this.settings)) {
                    if (embed.hasAttribute('data-chem3d-preview-done')) return;
                    embed.setAttribute('data-chem3d-preview-done', 'true');

                    embed.classList.add('chem3d-custom-embed');
                    const container = document.createElement('div');
                    (embed as HTMLElement).empty();
                    embed.appendChild(container); 
                    
                    applyHostWidth(embed as HTMLElement, size);

                    const renderData: RenderData = { type: 'file', content: cleanSrc, sourcePath: context.sourcePath, ...size };
                    context.addChild(new MolstarRenderChild(container, renderData, this.app, this.settings));
                }
            });
        });

        this.registerEditorExtension(this.buildLivePreviewPlugin());
    }

    buildLivePreviewPlugin() {
        const plugin = this;
        return ViewPlugin.fromClass(class {
            // Obsidian reuses the embed element when only the alias changes, so the
            // rendered spec is tracked here to tell a resize from a different file.
            activeEmbeds = new Map<HTMLElement, { child: MolstarRenderChild; path: string; size: EmbedSize }>();
            pending = new Set<HTMLElement>();
            debounceTimer: number | null = null;

            constructor(public view: EditorView) {
                this.processEmbeds();
            }

            update(update: ViewUpdate) {
                if (update.docChanged || update.viewportChanged || update.selectionSet) {
                    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
                    this.debounceTimer = window.setTimeout(() => this.processEmbeds(), 100);
                }
            }

            processEmbeds() {
                for (const [el, active] of this.activeEmbeds.entries()) {
                    if (!this.view.dom.contains(el)) {
                        active.child.onunload();
                        this.activeEmbeds.delete(el);
                    }
                }

                const embeds = Array.from(this.view.dom.querySelectorAll('.internal-embed'));

                embeds.forEach(embed => {
                    const src = embed.getAttribute('src');
                    if (!src) return;
                    const { path: cleanSrc } = parseEmbedLink(src);
                    const size = parseEmbedElementSize(embed, src);

                    if (!isFileSupported(cleanSrc, plugin.settings)) return;

                    const el = embed as HTMLElement;
                    if (this.pending.has(el)) return;

                    const active = this.activeEmbeds.get(el);
                    if (active) {
                        const stillMounted = el.contains(active.child.containerEl);
                        if (stillMounted && active.path === cleanSrc) {
                            // Same file, only the size suffix moved: resize, do not rebuild.
                            if (active.size.width !== size.width || active.size.height !== size.height) {
                                applyHostWidth(el, size);
                                active.child.applySize(size);
                                active.size = size;
                            }
                            return;
                        }
                        active.child.onunload();
                        this.activeEmbeds.delete(el);
                        el.removeAttribute('data-chem3d-preview-done');
                    }

                    if (el.hasAttribute('data-chem3d-preview-done')) {
                        // The marker also keeps the reading-view processor off this element,
                        // so only step in once the viewer it stood for has actually gone.
                        if (el.querySelector('.chem3d-root-wrapper')) return;
                        el.removeAttribute('data-chem3d-preview-done');
                    }

                    el.setAttribute('data-chem3d-preview-done', 'true');
                    this.pending.add(el);

                    const activeFile = plugin.app.workspace.getActiveFile();
                    const sourcePath = activeFile ? activeFile.path : "";

                    plugin.injectNativeEmbedLivePreview(el, cleanSrc, sourcePath, size)
                        .then(child => {
                            if (child) this.activeEmbeds.set(el, { child, path: cleanSrc, size });
                        })
                        .finally(() => this.pending.delete(el))
                        .catch(() => {});
                });
            }

            destroy() {
                if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
                for (const active of this.activeEmbeds.values()) {
                    active.child.onunload();
                }
                this.activeEmbeds.clear();
                this.pending.clear();
            }
        });
    }

    async injectNativeEmbedLivePreview(embed: HTMLElement, cleanSrc: string, sourcePath: string, size: EmbedSize = {}): Promise<MolstarRenderChild | null> {
        const file = resolveVaultFile(this.app, cleanSrc, sourcePath);
        if (!file) {
            embed.empty();
            const errBox = embed.createDiv({ text: `File not found: ${cleanSrc}`, cls: 'color-red' });
            errBox.style.padding = '8px';
            return null;
        }

        embed.classList.add('chem3d-custom-embed');
        const container = document.createElement('div');
        embed.empty();
        embed.appendChild(container);

        applyHostWidth(embed, size);

        const renderData: RenderData = { type: 'file', content: cleanSrc, sourcePath, ...size };
        const renderChild = new MolstarRenderChild(container, renderData, this.app, this.settings);

        await renderChild.onload();
        return renderChild;
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

// =========================================================================
// SETTINGS TAB
// =========================================================================

class ChemRender3DSettingTab extends PluginSettingTab {
    constructor(app: App, public plugin: ChemRender3DPlugin) {
        super(app, plugin);
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'ChemRender3D Settings' });

        new Setting(containerEl)
            .setName('Supported File Extensions')
            .setDesc('Comma-separated extensions to preview automatically (MOL, SDF, VASP, Gaussian, QE, XYZ, PDB, CIF, Cube and Mol* sessions are natively supported).')
            .addText(text => text
                .setValue(this.plugin.settings.supportedExtensions)
                .onChange(async (value) => {
                    this.plugin.settings.supportedExtensions = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Default Grid Columns')
            .setDesc('Default number of cards per row in 2d-grid and 3dmol-grid (e.g. 2, 3, or 4).')
            .addSlider(slider => slider
                .setLimits(2, 5, 1)
                .setValue(this.plugin.settings.defaultGridColumns)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.defaultGridColumns = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Show Quick Action Toolbar')
            .setDesc('Displays the floating HUD icons (Figure Snapshot, 2D Diagram, Spin).')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showQuickToolbar)
                .onChange(async (value) => {
                    this.plugin.settings.showQuickToolbar = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Prevent opening external apps on click')
            .setDesc('Prevents Obsidian from delegating clicks to OS external software like PyMOL.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.preventAppClick)
                .onChange(async (value) => {
                    this.plugin.settings.preventAppClick = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('VASP Default Supercell Expansion')
            .setDesc('Replicate crystal unit cells along a, b, c axes (e.g. "1 1 1" for primitive cell, "2 2 1" for 2D sheets, "2 2 2" for 3D bulk).')
            .addText(text => text
                .setPlaceholder('1 1 1')
                .setValue(this.plugin.settings.poscarSupercell)
                .onChange(async (value) => {
                    this.plugin.settings.poscarSupercell = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Default Visual Preset')
            .addDropdown(dropdown => dropdown
                .addOption('auto', 'Default (Ball & Stick / Standard)')
                .addOption('illustrative', 'Illustrative (David Goodsell style)')
                .addOption('polymer-and-ligand', 'Polymer & Ligand')
                .setValue(this.plugin.settings.defaultPreset)
                .onChange(async (value: any) => {
                    this.plugin.settings.defaultPreset = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Auto-spin camera')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoSpinCamera)
                .onChange(async (value) => {
                    this.plugin.settings.autoSpinCamera = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Auto-play trajectory animations')
            .setDesc('Automatically loops multi-frame simulations (like VASP XDATCAR or multi-step XYZ trajectories).')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoPlayTrajectory)
                .onChange(async (value) => {
                    this.plugin.settings.autoPlayTrajectory = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Viewer Height')
            .addText(text => text
                .setValue(this.plugin.settings.viewerHeight)
                .onChange(async (value) => {
                    this.plugin.settings.viewerHeight = value;
                    await this.plugin.saveSettings();
                }));
    }
}