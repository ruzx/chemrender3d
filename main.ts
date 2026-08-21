import { Plugin, PluginSettingTab, App, Setting, TFile, MarkdownRenderChild } from 'obsidian';
import { createPluginUI } from 'molstar/lib/mol-plugin-ui';
import { renderReact18 } from 'molstar/lib/mol-plugin-ui/react18';
import { Color } from 'molstar/lib/mol-util/color';
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";

// --- Data Interfaces ---
interface RenderData {
    type: 'file' | 'smiles';
    content: string;
    sourcePath: string;
}

interface ChemRender3DSettings {
    autoPlayTrajectory: boolean;
    autoSpinCamera: boolean;
    showUIPanels: boolean;
    viewerHeight: string;
    supportedExtensions: string;
    showNonCovalent: boolean;
    maxPixelRatio: number;
    preventAppClick: boolean;
    defaultPreset: 'auto' | 'illustrative' | 'polymer-and-ligand' | 'ball-and-stick';
    gridMaxFiles: number;
}

const DEFAULT_SETTINGS: ChemRender3DSettings = {
    autoPlayTrajectory: true,
    autoSpinCamera: false,
    showUIPanels: false,
    viewerHeight: '400px',
    supportedExtensions: 'pdb, cif, mol, sdf, xyz',
    showNonCovalent: false,
    maxPixelRatio: 1.0,
    preventAppClick: true,
    defaultPreset: 'auto',
    gridMaxFiles: 12
}

// --- Supported Format Mapping ---
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
    'xyz': 'xyz'
};

function getActiveExtensions(settings: ChemRender3DSettings): string[] {
    return settings.supportedExtensions
        .split(',')
        .map(s => s.trim().toLowerCase().replace(/^\./, ''))
        .filter(s => s.length > 0);
}

// --- Lifecycle Component ---
class MolstarRenderChild extends MarkdownRenderChild {
    pluginInstance: any = null;
    settings: ChemRender3DSettings;
    renderData: RenderData;
    pluginApp: App;

    constructor(containerEl: HTMLElement, renderData: RenderData, pluginApp: App, settings: ChemRender3DSettings) {
        super(containerEl);
        this.renderData = renderData;
        this.pluginApp = pluginApp;
        this.settings = settings;
    }

    async onload() {
        const viewerContainer = this.containerEl.createDiv({ cls: 'molstar-viewer-container' });
        viewerContainer.style.width = '100%';
        viewerContainer.style.height = this.settings.viewerHeight; 
        viewerContainer.style.position = 'relative';
        viewerContainer.style.borderRadius = '8px';
        viewerContainer.style.overflow = 'hidden';
        viewerContainer.style.border = '1px solid var(--background-modifier-border)';

        if (this.settings.preventAppClick) {
            const stopEvent = (e: Event) => e.stopPropagation();
            viewerContainer.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
            viewerContainer.addEventListener('mousedown', stopEvent);
            viewerContainer.addEventListener('mouseup', stopEvent);
            viewerContainer.addEventListener('dblclick', stopEvent);
        }

        const origWarn = console.warn;
        const origError = console.error;
        const origLog = console.log;

        const silenceMolstarSpam = (...args: any[]) => {
            if (typeof args[0] === 'string' && (args[0].includes('already added') || args[0].includes('computed.accessible-surface-area'))) return true;
            return false;
        };

        console.warn = (...args: any[]) => { if (!silenceMolstarSpam(...args)) origWarn.apply(console, args); };
        console.error = (...args: any[]) => { if (!silenceMolstarSpam(...args)) origError.apply(console, args); };
        console.log = (...args: any[]) => { if (!silenceMolstarSpam(...args)) origLog.apply(console, args); };

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

            if (this.renderData.type === 'file') {
                const file = this.pluginApp.metadataCache.getFirstLinkpathDest(this.renderData.content, this.renderData.sourcePath);
                if (!(file instanceof TFile)) {
                    this.containerEl.createEl('div', { text: `ChemRender3D Error: File not found in vault: ${this.renderData.content}`, cls: "color-red" });
                    return;
                }
                rawStringData = await this.pluginApp.vault.read(file);
                const ext = file.extension.toLowerCase();
                
                if (!(ext in FORMAT_MAP)) {
                    this.containerEl.createEl('div', { text: `ChemRender3D Error: Unsupported format .${ext}`, cls: "color-red" });
                    return;
                }
                parsedFormat = FORMAT_MAP[ext];
                
            } else if (this.renderData.type === 'smiles') {
                try {
                    const response = await fetch(`https://cactus.nci.nih.gov/chemical/structure/${encodeURIComponent(this.renderData.content)}/file?format=sdf&get3d=true`);
                    if (!response.ok) throw new Error('Resolver could not generate 3D coordinates.');
                    rawStringData = await response.text();
                    parsedFormat = 'sdf';
                } catch (fetchErr) {
                    this.containerEl.createEl('div', { text: `SMILES Resolution Error: ${fetchErr}`, cls: "color-red" });
                    return;
                }
            }

            const data = await this.pluginInstance.builders.data.rawData({ data: rawStringData });
            const trajectory = await this.pluginInstance.builders.structure.parseTrajectory(data, parsedFormat);
            
            // --- FIX FOR PRESETS ---
            // We must explicitly build the Model and Structure BEFORE applying representation presets!
            const model = await this.pluginInstance.builders.structure.createModel(trajectory);
            const structure = await this.pluginInstance.builders.structure.createStructure(model);
            
            await this.pluginInstance.builders.structure.representation.applyPreset(structure, this.settings.defaultPreset);

            const isDark = document.body.classList.contains('theme-dark');
            const bgColor = isDark ? Color(0x1e1e1e) : Color(0xffffff); 
            
            if (this.pluginInstance.canvas3d) {
                this.pluginInstance.canvas3d.setProps({
                    renderer: { backgroundColor: bgColor },
                    pixelScale: this.settings.maxPixelRatio
                });

                if (this.settings.autoSpinCamera) {
                    this.pluginInstance.canvas3d.setProps({
                        trackball: { animate: { name: 'spin', params: { speed: 1 } } }
                    });
                }
            }

            if (this.settings.showNonCovalent && structure) {
                try {
                    await this.pluginInstance.builders.structure.representation.addRepresentation(
                        structure, 
                        { type: 'noncovalent-interactions' }
                    );
                } catch (err) {
                    // Silently ignore if representation generation fails
                }
            }

            if (this.settings.autoPlayTrajectory) {
                setTimeout(async () => {
                    try {
                        if (this.pluginInstance && this.pluginInstance.managers.animation) {
                            await this.pluginInstance.managers.animation.play();
                        }
                    } catch (animError) {
                        // Silently ignore if the loaded file does not contain multiple frames
                    }
                }, 250); 
            }
            
        } catch (err) {
            this.containerEl.createEl('div', { text: `Error loading 3D model: ${err}`, cls: "color-red", style: "padding: 10px;" });
        } finally {
            console.warn = origWarn;
            console.error = origError;
            console.log = origLog;
        }
    }

    onunload() {
        if (this.pluginInstance) {
            try {
                this.pluginInstance.dispose();
            } catch (e) {}
            this.pluginInstance = null;
        }
    }
}

// --- Main Plugin Class ---
export default class ChemRender3DPlugin extends Plugin {
    settings: ChemRender3DSettings;

    async onload() {
        console.log('Loading ChemRender3D plugin');
        await this.loadSettings();
        this.addSettingTab(new ChemRender3DSettingTab(this.app, this));

        // 1. Standard 3D Block Processor
        this.registerMarkdownCodeBlockProcessor('3dmol', (source, el, ctx) => {
            const sourceTrimmed = source.trim();
            const filenameMatch = sourceTrimmed.match(/^!?\[\[(.*?)\]\]$/);

            if (filenameMatch && filenameMatch[1]) {
                const cleanFilename = decodeURIComponent(filenameMatch[1]).split('#')[0].split('|')[0].trim();
                const renderData: RenderData = { type: 'file', content: cleanFilename, sourcePath: ctx.sourcePath };
                ctx.addChild(new MolstarRenderChild(el, renderData, this.app, this.settings));
            } else {
                const renderData: RenderData = { type: 'smiles', content: sourceTrimmed, sourcePath: ctx.sourcePath };
                ctx.addChild(new MolstarRenderChild(el, renderData, this.app, this.settings));
            }
        });

        // 2. NEW Feature: 3DMol Grid Processor (Folder Preview)
        this.registerMarkdownCodeBlockProcessor('3dmol-grid', async (source, el, ctx) => {
            const folderMatch = source.match(/folder:\s*(.+)/i);
            if (!folderMatch) {
                el.createEl('div', { text: 'ChemRender3D Grid Error: Provide a folder path (e.g., "folder: Assets/Molecules")', cls: 'color-red' });
                return;
            }

            const folderPath = folderMatch[1].trim();
            const folder = this.app.vault.getAbstractFileByPath(folderPath);

            if (!folder || !('children' in folder)) {
                el.createEl('div', { text: `ChemRender3D Grid Error: Folder not found "${folderPath}"`, cls: 'color-red' });
                return;
            }

            const files = folder.children
                .filter(f => f instanceof TFile && FORMAT_MAP[f.extension.toLowerCase()])
                .slice(0, this.settings.gridMaxFiles);

            if (files.length === 0) {
                el.createEl('div', { text: `No supported 3D molecules found in "${folderPath}".` });
                return;
            }

            const gridContainer = el.createDiv({ style: 'display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 15px; margin-top: 10px;' });

            // Customize settings specifically for grid items to keep it clean and performant
            const gridSettings: ChemRender3DSettings = {
                ...this.settings,
                showUIPanels: false,
                autoSpinCamera: false, // Prevents chaos when 12 models are spinning at once
                viewerHeight: '200px',
                preventAppClick: true
            };

            for (const file of files) {
                const cell = gridContainer.createDiv({ style: 'display: flex; flex-direction: column; gap: 5px; background: var(--background-secondary); padding: 8px; border-radius: 8px; border: 1px solid var(--background-modifier-border);' });
                
                const title = cell.createDiv({ text: file.name, style: 'text-align: center; font-size: 0.9em; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' });
                title.title = file.name;

                const viewerEl = cell.createDiv();
                const renderData: RenderData = { type: 'file', content: file.path, sourcePath: ctx.sourcePath };
                
                const child = new MolstarRenderChild(viewerEl, renderData, this.app, gridSettings);
                ctx.addChild(child);
            }

            if (folder.children.length > this.settings.gridMaxFiles) {
                el.createDiv({ text: `Showing first ${this.settings.gridMaxFiles} files. Edit Grid Max Files in settings to see more.`, style: 'text-align: center; margin-top: 10px; font-size: 0.85em; color: var(--text-muted);' });
            }
        });

        // 3. Post Processor for native ![[file.ext]]
        this.registerMarkdownPostProcessor((element, context) => {
            const embeds = Array.from(element.querySelectorAll('.internal-embed'));
            if (element.classList?.contains('internal-embed')) embeds.push(element);
            
            const activeExtensions = getActiveExtensions(this.settings);
            
            embeds.forEach((embed) => {
                const src = embed.getAttribute('src');
                if (src) {
                    const cleanSrc = decodeURIComponent(src).split('#')[0].split('?')[0].split('|')[0].trim();
                    const ext = cleanSrc.split('.').pop()?.toLowerCase() || '';
                    
                    if (activeExtensions.includes(ext) && ext in FORMAT_MAP) {
                        if (embed.hasAttribute('data-chem3d-preview-done')) return;
                        embed.setAttribute('data-chem3d-preview-done', 'true');

                        embed.classList.add('chem3d-custom-embed');
                        const container = document.createElement('div');
                        embed.innerHTML = '';
                        embed.appendChild(container); 
                        
                        const renderData: RenderData = { type: 'file', content: cleanSrc, sourcePath: context.sourcePath };
                        const renderChild = new MolstarRenderChild(container, renderData, this.app, this.settings);
                        context.addChild(renderChild);
                    }
                }
            });
        });

        this.registerEditorExtension(this.buildLivePreviewPlugin());
    }

    onunload() {
        console.log('Unloading ChemRender3D plugin');
    }

    buildLivePreviewPlugin() {
        const plugin = this;
        return ViewPlugin.fromClass(class {
            activeEmbeds = new Map<HTMLElement, MolstarRenderChild>();
            debounceTimer: number | null = null;

            constructor(public view: EditorView) {
                this.processEmbeds();
            }

            update(update: ViewUpdate) {
                if (update.docChanged || update.viewportChanged) {
                    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
                    this.debounceTimer = window.setTimeout(() => this.processEmbeds(), 100);
                }
            }

            processEmbeds() {
                for (const [el, renderChild] of this.activeEmbeds.entries()) {
                    if (!this.view.dom.contains(el)) {
                        renderChild.onunload();
                        this.activeEmbeds.delete(el);
                    }
                }

                const embeds = Array.from(this.view.dom.querySelectorAll('.internal-embed'));
                const activeExtensions = getActiveExtensions(plugin.settings);

                embeds.forEach(embed => {
                    const src = embed.getAttribute('src');
                    if (!src) return;
                    
                    const cleanSrc = decodeURIComponent(src).split('#')[0].split('?')[0].split('|')[0].trim();
                    const ext = cleanSrc.split('.').pop()?.toLowerCase() || '';

                    if (activeExtensions.includes(ext) && ext in FORMAT_MAP) {
                        if (embed.hasAttribute('data-chem3d-preview-done')) return;
                        embed.setAttribute('data-chem3d-preview-done', 'true');
                        
                        const activeFile = plugin.app.workspace.getActiveFile();
                        const sourcePath = activeFile ? activeFile.path : "";
                        
                        plugin.injectNativeEmbedLivePreview(embed as HTMLElement, cleanSrc, sourcePath).then(child => {
                            if (child) {
                                this.activeEmbeds.set(embed as HTMLElement, child);
                            }
                        });
                    }
                });
            }

            destroy() {
                if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
                for (const renderChild of this.activeEmbeds.values()) {
                    renderChild.onunload();
                }
                this.activeEmbeds.clear();
            }
        });
    }

    async injectNativeEmbedLivePreview(embed: HTMLElement, cleanSrc: string, sourcePath: string): Promise<MolstarRenderChild | null> {
        const file = this.app.metadataCache.getFirstLinkpathDest(cleanSrc, sourcePath);
        if (!(file instanceof TFile)) {
            embed.innerHTML = `<div class="color-red" style="padding:10px; border:1px solid red; border-radius:8px;">File not found: ${cleanSrc}</div>`;
            return null;
        }

        embed.classList.add('chem3d-custom-embed');
        const container = document.createElement('div');
        embed.innerHTML = '';
        embed.appendChild(container);

        const renderData: RenderData = { type: 'file', content: cleanSrc, sourcePath };
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

// --- Settings Tab ---
class ChemRender3DSettingTab extends PluginSettingTab {
    plugin: ChemRender3DPlugin;

    constructor(app: App, plugin: ChemRender3DPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'ChemRender3D Settings' });

        containerEl.createEl('h3', { text: 'Embed & Format Behaviors' });

        new Setting(containerEl)
            .setName('Supported File Extensions')
            .setDesc('Comma-separated list of extensions that should render 3D views automatically via ![[file.ext]] embeds.')
            .addText(text => text
                .setPlaceholder('pdb, cif, mol, xyz, sdf')
                .setValue(this.plugin.settings.supportedExtensions)
                .onChange(async (value) => {
                    this.plugin.settings.supportedExtensions = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Prevent opening external apps on click')
            .setDesc('When clicking a 3D model, Obsidian normally tries to open the file in its default external application. Turning this on stops that.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.preventAppClick)
                .onChange(async (value) => {
                    this.plugin.settings.preventAppClick = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: 'Graphics & Performance' });

        new Setting(containerEl)
            .setName('Default Visual Preset')
            .setDesc('Choose the default visual style for rendered molecules. (Illustrative mode looks stunning for proteins!).')
            .addDropdown(dropdown => dropdown
                .addOption('auto', 'Default (Standard)')
                .addOption('illustrative', 'Illustrative (David Goodsell style)')
                .addOption('polymer-and-ligand', 'Polymer & Ligand')
                .addOption('ball-and-stick', 'Ball and Stick')
                .setValue(this.plugin.settings.defaultPreset)
                .onChange(async (value: any) => {
                    this.plugin.settings.defaultPreset = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Grid Max Files')
            .setDesc('Maximum number of molecules to render when using the 3dmol-grid folder viewer. Keep this under 20 to prevent WebGL memory crashes.')
            .addText(text => text
                .setPlaceholder('12')
                .setValue(this.plugin.settings.gridMaxFiles.toString())
                .onChange(async (value) => {
                    const parsed = parseInt(value);
                    if (!isNaN(parsed)) {
                        this.plugin.settings.gridMaxFiles = parsed;
                        await this.plugin.saveSettings();
                    }
                }));

        new Setting(containerEl)
            .setName('Show Non-Covalent Interactions')
            .setDesc('Automatically compute and display hydrogen bonds, salt bridges, etc.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showNonCovalent)
                .onChange(async (value) => {
                    this.plugin.settings.showNonCovalent = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Max Pixel Ratio (Performance Cap)')
            .setDesc('Caps rendering resolution. Set to 1.0 for better performance and battery life on Retina/4K displays. Increase up to 3.0 for extreme graphics.')
            .addSlider(slider => slider
                .setLimits(0.5, 3.0, 0.25)
                .setValue(this.plugin.settings.maxPixelRatio)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.maxPixelRatio = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: 'Visual Defaults' });

        new Setting(containerEl)
            .setName('Auto-spin camera')
            .setDesc('Automatically rotate the 3D structure when loaded.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoSpinCamera)
                .onChange(async (value) => {
                    this.plugin.settings.autoSpinCamera = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Auto-play trajectory animations')
            .setDesc('Automatically start playback for multi-frame files (like .xyz trajectories).')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoPlayTrajectory)
                .onChange(async (value) => {
                    this.plugin.settings.autoPlayTrajectory = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Show UI Panels by default')
            .setDesc('Show Mol* control panels. Turn off for a cleaner look when embedding in notes.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showUIPanels)
                .onChange(async (value) => {
                    this.plugin.settings.showUIPanels = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Viewer Height')
            .setDesc('Set the default height for embedded 3D viewers (e.g., 400px).')
            .addText(text => text
                .setPlaceholder('400px')
                .setValue(this.plugin.settings.viewerHeight)
                .onChange(async (value) => {
                    this.plugin.settings.viewerHeight = value;
                    await this.plugin.saveSettings();
                }));
    }
}