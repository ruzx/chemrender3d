/**
 * Orbital display inside a Mol* viewer: drives the alpha-orbitals extension and
 * draws an interactive MO energy-level diagram next to the structure.
 */

import {
    CreateOrbitalDensityVolume, CreateOrbitalRepresentation3D, CreateOrbitalVolume, StaticBasisAndOrbitals
} from 'molstar/lib/extensions/alpha-orbitals/transforms';
import { Color } from 'molstar/lib/mol-util/color';
import { frontierLabel, OrbitalSet, parseOrbitalSelector } from './types';

export type OrbitalTarget = number | 'density';

export interface OrbitalViewOptions {
    /** "HOMO", "LUMO+1", "density", or a 1-based MO number. */
    initial?: string;
    /** Relative isovalue multiplier (1 = Mol*'s automatic 85% contour). */
    iso?: number;
    positiveColor?: number;
    negativeColor?: number;
    /** Translucent "glow" surfaces like the Mol* demo, or solid lobes. */
    style?: 'xray' | 'solid';
}

const STYLE_ID = 'chem3d-orbital-styles';
const CSS = `
.chem3d-mo-panel{position:absolute;top:42px;left:8px;bottom:28px;width:178px;z-index:16;display:flex;flex-direction:column;
  background:rgba(28,28,30,.88);backdrop-filter:blur(6px);color:#e4e4e7;border-radius:8px;font-size:11px;
  box-shadow:0 2px 8px rgba(0,0,0,.3);overflow:hidden;font-family:var(--font-interface,sans-serif)}
.chem3d-mo-head{padding:6px 8px 4px;border-bottom:1px solid rgba(255,255,255,.08)}
.chem3d-mo-title{display:flex;justify-content:space-between;align-items:center;font-weight:600;font-size:11.5px}
.chem3d-mo-title button{background:none;border:none;color:#a1a1aa;cursor:pointer;padding:0 2px;font-size:14px;line-height:1;box-shadow:none}
.chem3d-mo-title button:hover{color:#fff}
.chem3d-mo-sub{color:#a1a1aa;font-size:10px;margin-top:1px}
.chem3d-mo-list{flex:1;overflow-y:auto;padding:4px 0}
.chem3d-mo-row{display:grid;grid-template-columns:34px 1fr auto;align-items:center;gap:6px;padding:2px 8px;cursor:pointer;font-family:var(--font-monospace,monospace)}
.chem3d-mo-row:hover{background:rgba(255,255,255,.08)}
.chem3d-mo-row.is-active{background:rgba(56,189,248,.22)}
.chem3d-mo-row.is-frontier .chem3d-mo-name{color:#fde047;font-weight:600}
.chem3d-mo-level{position:relative;height:14px}
.chem3d-mo-level::after{content:"";position:absolute;left:0;right:0;top:7px;height:2px;border-radius:1px;background:#71717a}
.chem3d-mo-row.is-occ .chem3d-mo-level::after{background:#38bdf8}
.chem3d-mo-arrows{position:absolute;left:0;right:0;top:-1px;text-align:center;font-size:11px;line-height:14px;color:#f4f4f5;z-index:1}
.chem3d-mo-energy{color:#a1a1aa}
.chem3d-mo-gap{text-align:center;color:#71717a;font-size:10px;padding:3px 0;border-top:1px dashed rgba(255,255,255,.12);border-bottom:1px dashed rgba(255,255,255,.12);margin:2px 8px}
.chem3d-mo-foot{padding:6px 8px;border-top:1px solid rgba(255,255,255,.08);display:flex;flex-direction:column;gap:5px}
.chem3d-mo-info{min-height:28px;color:#d4d4d8;line-height:1.35}
.chem3d-mo-info b{color:#fff}
.chem3d-mo-controls{display:flex;gap:4px}
.chem3d-mo-controls button{flex:1;background:rgba(255,255,255,.08);border:none;color:#e4e4e7;border-radius:4px;padding:3px 0;cursor:pointer;font-size:11px;box-shadow:none;height:auto}
.chem3d-mo-controls button:hover{background:rgba(255,255,255,.18)}
.chem3d-mo-controls button.is-on{background:rgba(56,189,248,.35)}
.chem3d-mo-iso{display:flex;align-items:center;gap:6px;color:#a1a1aa}
.chem3d-mo-iso input{flex:1;min-width:0;height:4px}
.chem3d-mo-note{color:#a1a1aa;font-size:9.5px;line-height:1.3}
.chem3d-mo-status{color:#fca5a5;font-size:10px}
`;

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
}

export class OrbitalController {
    private basisRef: any = null;
    private selectors: { type: 'orbital' | 'density'; volume: any; positive: any; negative?: any } | undefined;
    private current: OrbitalTarget | undefined;
    private wanted: OrbitalTarget | undefined;
    private running: Promise<void> | null = null;
    private iso: number;
    private disposed = false;

    private panel: HTMLElement | null = null;
    private list: HTMLElement | null = null;
    private info: HTMLElement | null = null;
    private status: HTMLElement | null = null;
    private densityBtn: HTMLButtonElement | null = null;
    private rows = new Map<number, HTMLElement>();

    constructor(private plugin: any, private host: HTMLElement, public readonly set: OrbitalSet, private options: OrbitalViewOptions = {}) {
        this.iso = options.iso && options.iso > 0 ? options.iso : 1;
    }

    get isVisible() { return !!this.panel && this.panel.style.display !== 'none'; }

    async init() {
        this.basisRef = await this.plugin.build().toRoot()
            .apply(StaticBasisAndOrbitals, {
                label: this.set.method,
                basis: this.set.basis,
                order: this.set.order,
                orbitals: this.set.orbitals
            } as any)
            .commit();

        this.buildPanel();

        const initial = (this.options.initial || '').trim();
        let target: OrbitalTarget = this.set.homo >= 0 ? this.set.homo : 0;
        if (/^dens/i.test(initial)) target = 'density';
        else if (initial && !/^(true|yes|on|all)$/i.test(initial)) {
            const idx = parseOrbitalSelector(initial, this.set);
            if (idx !== null) target = idx;
            else this.setStatus(`Unknown orbital "${initial}" — showing HOMO.`);
        }
        await this.show(target);
    }

    /** Queue a display change; rapid clicks collapse into the latest request. */
    show(target: OrbitalTarget): Promise<void> {
        this.wanted = target;
        this.markActive(target);
        if (!this.running) {
            this.running = this.drain().finally(() => { this.running = null; });
        }
        return this.running;
    }

    async setVisible(visible: boolean) {
        if (!this.panel) return;
        this.panel.style.display = visible ? 'flex' : 'none';
        if (visible) {
            const t = this.current ?? (this.set.homo >= 0 ? this.set.homo : 0);
            this.current = undefined;
            await this.show(t);
        } else {
            this.wanted = undefined;
            await this.clearVolume();
            this.current = undefined;
        }
    }

    async dispose() {
        this.disposed = true;
        this.panel?.remove();
        this.panel = null;
        try {
            await this.clearVolume();
            if (this.basisRef) await this.plugin.build().delete(this.basisRef).commit();
        } catch (_) { /* plugin may already be gone */ }
    }

    // ------------------------------------------------------------------ Mol*

    private async drain() {
        while (!this.disposed && this.wanted !== undefined && this.wanted !== this.current) {
            const target: OrbitalTarget = this.wanted;
            try {
                await this.apply(target);
                this.setStatus('');
            } catch (e: any) {
                const msg = String(e?.message || e);
                this.setStatus(/OES_texture_float|WebGL/i.test(msg)
                    ? 'This device cannot compute densities on the GPU; individual orbitals still work.'
                    : `Could not draw orbital: ${msg}`);
                await this.clearVolume().catch(() => {});
            }
            this.current = target;
            this.updateInfo(target);
        }
    }

    private async clearVolume() {
        if (!this.selectors) return;
        const v = this.selectors.volume;
        this.selectors = undefined;
        await this.plugin.build().delete(v).commit();
    }

    private async apply(target: OrbitalTarget) {
        const kind = target === 'density' ? 'density' : 'orbital';
        if (this.selectors && this.selectors.type !== kind) await this.clearVolume();

        const update = this.plugin.build();
        if (kind === 'orbital') {
            if (!this.selectors) {
                const volume = update.to(this.basisRef).apply(CreateOrbitalVolume, { index: target } as any);
                const positive = volume.apply(CreateOrbitalRepresentation3D, this.reprParams('positive')).selector;
                const negative = volume.apply(CreateOrbitalRepresentation3D, this.reprParams('negative')).selector;
                this.selectors = { type: 'orbital', volume: volume.selector, positive, negative };
            } else {
                update.to(this.selectors.volume).update(CreateOrbitalVolume, (old: any) => ({ ...old, index: target }));
            }
        } else if (!this.selectors) {
            const volume = update.to(this.basisRef).apply(CreateOrbitalDensityVolume);
            const positive = volume.apply(CreateOrbitalRepresentation3D, this.reprParams('positive', true)).selector;
            this.selectors = { type: 'density', volume: volume.selector, positive };
        }
        await update.commit();
    }

    private reprParams(kind: 'positive' | 'negative', density = false): any {
        const pos = this.options.positiveColor ?? 0x3B82F6;
        const neg = this.options.negativeColor ?? 0xEF4444;
        const xray = (this.options.style ?? 'xray') === 'xray';
        return {
            alpha: density ? 0.55 : (xray ? 0.85 : 0.7),
            color: Color(density ? 0x9CA3AF : kind === 'positive' ? pos : neg),
            kind,
            relativeIsovalue: this.iso,
            pickable: false,
            xrayShaded: xray,
            tryUseGpu: true
        };
    }

    private async setIso(value: number) {
        this.iso = value;
        if (!this.selectors) return;
        const update = this.plugin.build();
        const density = this.selectors.type === 'density';
        update.to(this.selectors.positive).update(this.reprParams('positive', density));
        if (this.selectors.negative) update.to(this.selectors.negative).update(this.reprParams('negative'));
        await update.commit();
    }

    // ------------------------------------------------------------------ panel

    private buildPanel() {
        ensureStyles();
        const set = this.set;
        const panel = el('div', 'chem3d-mo-panel', this.host);
        this.panel = panel;
        // Keep clicks and scrolls in the panel away from the 3D canvas and Obsidian.
        ['click', 'mousedown', 'wheel', 'pointerdown'].forEach(evt =>
            panel.addEventListener(evt, e => e.stopPropagation(), { passive: evt === 'wheel' } as any));

        const head = el('div', 'chem3d-mo-head', panel);
        const title = el('div', 'chem3d-mo-title', head);
        el('span', '', title, set.method);
        const close = el('button', '', title, '×');
        close.title = 'Hide orbitals';
        close.onclick = () => { void this.setVisible(false); };
        el('div', 'chem3d-mo-sub', head, set.notes[0] || '');

        const list = el('div', 'chem3d-mo-list', panel);
        this.list = list;
        this.rows.clear();
        const n = set.info.length;
        for (let k = n - 1; k >= 0; k--) {
            const inf = set.info[k];
            const row = el('div', 'chem3d-mo-row', list);
            if (inf.occupancy > 0) row.classList.add('is-occ');
            if (k === set.homo || k === set.homo + 1) row.classList.add('is-frontier');
            const level = el('div', 'chem3d-mo-level', row);
            const arrows = inf.occupancy >= 1.5 ? '↑↓' : inf.occupancy > 0 ? '↑' : '';
            el('div', 'chem3d-mo-arrows', level, arrows);
            el('span', 'chem3d-mo-name', row, frontierLabel(k, set.homo));
            const energy = el('span', 'chem3d-mo-energy', row, inf.energyEV.toFixed(2));
            energy.title = set.qualitative ? `${inf.energyEV.toFixed(3)} eV` : `${inf.energyEV.toFixed(3)} eV · ${this.set.orbitals[k].energy.toFixed(5)} Eh`;
            row.onclick = () => { void this.show(k); };
            this.rows.set(k, row);

            if (k === set.homo + 1 && set.homo >= 0) {
                const gap = set.info[set.homo + 1].energyEV - set.info[set.homo].energyEV;
                el('div', 'chem3d-mo-gap', list, `HOMO–LUMO gap ${gap.toFixed(2)} eV`);
            }
        }

        const foot = el('div', 'chem3d-mo-foot', panel);
        this.info = el('div', 'chem3d-mo-info', foot);

        const controls = el('div', 'chem3d-mo-controls', foot);
        const down = el('button', '', controls, '▼');
        down.title = 'Lower orbital';
        down.onclick = () => this.step(-1);
        const up = el('button', '', controls, '▲');
        up.title = 'Higher orbital';
        up.onclick = () => this.step(1);
        const dens = el('button', '', controls, 'ρ');
        dens.title = 'Total electron density';
        dens.onclick = () => { void this.show(this.current === 'density' ? (set.homo >= 0 ? set.homo : 0) : 'density'); };
        this.densityBtn = dens;

        const isoRow = el('label', 'chem3d-mo-iso', foot);
        el('span', '', isoRow, 'Size');
        const slider = el('input', '', isoRow);
        slider.type = 'range';
        slider.min = '0.3';
        slider.max = '3';
        slider.step = '0.05';
        // Larger slider value = bigger lobes = lower isovalue.
        slider.value = String(3.3 - this.iso);
        let isoTimer: number | null = null;
        slider.oninput = () => {
            if (isoTimer) window.clearTimeout(isoTimer);
            isoTimer = window.setTimeout(() => { void this.setIso(Math.max(0.3, 3.3 - parseFloat(slider.value))); }, 60);
        };

        this.status = el('div', 'chem3d-mo-status', foot);
        const note = set.qualitative
            ? 'Qualitative model (Extended Hückel). Shapes and nodes are right; energies are approximate.'
            : set.notes.slice(1).join(' ');
        if (note) el('div', 'chem3d-mo-note', foot, note);

        // Centre the frontier region once the panel has layout.
        window.requestAnimationFrame(() => {
            const row = this.rows.get(Math.max(0, set.homo));
            if (row && this.list) this.list.scrollTop = row.offsetTop - this.list.clientHeight / 2;
        });
    }

    private step(dir: 1 | -1) {
        const base = typeof this.wanted === 'number' ? this.wanted : (typeof this.current === 'number' ? this.current : this.set.homo);
        const next = Math.max(0, Math.min(this.set.orbitals.length - 1, base + dir));
        void this.show(next);
    }

    private markActive(target: OrbitalTarget) {
        this.rows.forEach((row, k) => row.classList.toggle('is-active', k === target));
        this.densityBtn?.classList.toggle('is-on', target === 'density');
        if (typeof target === 'number') {
            const row = this.rows.get(target);
            if (row && this.list) {
                const top = row.offsetTop, bottom = top + row.offsetHeight;
                if (top < this.list.scrollTop || bottom > this.list.scrollTop + this.list.clientHeight) {
                    this.list.scrollTop = top - this.list.clientHeight / 2;
                }
            }
        }
    }

    private updateInfo(target: OrbitalTarget) {
        if (!this.info) return;
        this.info.textContent = '';
        if (target === 'density') {
            el('b', '', this.info, 'Electron density');
            el('div', '', this.info, `${this.set.electrons} ${this.set.qualitative ? 'valence ' : ''}electrons`);
            return;
        }
        const inf = this.set.info[target];
        el('b', '', this.info, `${frontierLabel(target, this.set.homo)} · ${inf.energyEV.toFixed(2)} eV`);
        const occ = inf.occupancy >= 1.5 ? 'occupied' : inf.occupancy > 0 ? 'singly occupied' : 'empty';
        const parts = inf.contributions.map(c => `${c.label} ${(c.weight * 100).toFixed(0)}%`).join(', ');
        el('div', '', this.info, parts ? `${occ} · ${parts}` : occ);
    }

    private setStatus(msg: string) {
        if (this.status) this.status.textContent = msg;
    }
}
