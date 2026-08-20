# ChemRender3D

**Bring interactive 3D molecules to Obsidian.**

ChemRender3D integrates the powerful [Mol* (Molstar)](https://molstar.org/) viewer directly into your vault. Effortlessly view, rotate, and interact with complex proteins, crystal structures, and small molecules natively inside your notes.

### Quick Demo

<img width="800" height="956" alt="Image" src="https://github.com/user-attachments/assets/62d7cec3-1d4e-4330-a980-5836fa31b229" />

## ✨ Features

- **Native File Support:** Render `.pdb`, `.cif`, `.mol`, `.sdf`, `.xyz`, and more using standard Obsidian embeds (`![[protein.pdb]]`).
- **SMILES to 3D:** Type a simple SMILES string and automatically generate a 3D structure.
- **Beautiful Presets:** View structures in standard ribbon formats, or use the stunning "Illustrative" (David Goodsell) art style.
- **High Performance:** Configurable pixel-ratio caps ensure Obsidian runs smoothly, even with massive Ribosome or Viral structures.
- **Smart Interactions:** Auto-calculates hydrogen bonds, salt bridges, and non-covalent interactions.

---

## 🚀 How to Use

### 1. Native File Embeds (The Easy Way)
Drop a `.pdb` or `.xyz` file into your vault and embed it normally. ChemRender3D automatically replaces it with a fully interactive 3D viewer.

```markdown
![[hemoglobin.pdb]]
![[caffeine.sdf]]
```

### 2. SMILES to 3D (No files needed)
Use a `3dmol` code block with a SMILES string. The plugin will fetch the 3D coordinates on the fly. (No MM optimization, only for showcasing/teaching)

````markdown
```3dmol
CC(=O)OC1=CC=CC=C1C(=O)O
```
````

### 3. Explicit File Blocks
You can also use a code block to reference files if you prefer not to use native embeds:

````markdown
```3dmol
[[aspirin.mol]]
```
````

---

## ⚙️ Tips & Settings

- **Performance Cap:** If you are on a 4K or Retina display and notice lag, lower the **Max Pixel Ratio** in the plugin settings to `1.0` to double your frame rate.
- **Auto-Spin:** Turn on Auto-Spin in the settings to make your embedded molecules slowly rotate on the page.

## 📥 Installation
1. Open **Settings → Community plugins**.
2. Click **Browse** and search for **ChemRender3D**.
3. Click **Install** and then **Enable**.


Acknolegment: Mol* (/'molstar/) is a modern web-based open-source toolkit for visualisation and analysis of large-scale molecular data
