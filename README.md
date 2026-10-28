# ChemRender3D

**Bring interactive 3D molecules to Obsidian.**

ChemRender3D brings the [Mol*](https://molstar.org/) molecular viewer directly into your vault. Visualize and explore proteins, crystal structures, atoms and small molecules without leaving your notes.

<img width="800" alt="ChemRender3D demo" src="https://github.com/user-attachments/assets/62d7cec3-1d4e-4330-a980-5836fa31b229" />

## Features

* **Native embeds** — Render `.pdb`, `.cif`, `.mol`, `.sdf`, `.xyz`, and other supported molecular files.
* **Mol\* sessions** — Embed a `.molx` or `.molj` session and get back exactly the scene you saved.
* **SMILES to 3D** — Generate and visualize 3D molecular structures directly from SMILES.
* **Interactive visualization** — Rotate, zoom, and inspect structures inside your notes.
* **Multiple representations** — Explore structures using molecular, ribbon, surface, and illustrative styles.
* **Molecular interactions** — Detect hydrogen bonds, salt bridges, and other non-covalent interactions.
* **Performance controls** — Adjust rendering quality for large molecular structures.
* **Sized embeds** — Set a viewer's width and height with Obsidian's `|WIDTHxHEIGHT` suffix.



📝 Release Notes

**⚡ (1.0.4)**
- **Extended Chemical & Material Formats**.
- **2D Structure Mode:** Toggle between responsive 3D viewports and textbook 2D vector diagrams.
- **Fast 2D Collection Grid:** Folder previews now generate instant vector cards.
- **Click-to-3D Focus Modal:** Click any molecule in the grid gallery to launch a dedicated 3D inspection window.
  
- Use ```` ```2dmol ```` for any individual molecule, crystal, file, or SMILES:
     ````markdown
     ```2dmol
     c1ccccc1
     ```
     ````
     ````markdown
     ```2dmol
     [[m-Xylene_.mol]]
     ```
     ````
     ````markdown
     ```2dmol
     caffeine
     ```
     
     ````
     
  <img width="720" height="698" alt="image" src="https://github.com/user-attachments/assets/00cbdc18-a215-47cd-a7f1-0c08dfb2d6bc" />

2dmol demo:

  <img width="800" height="705" alt="2d and 3d" src="https://github.com/user-attachments/assets/1d203fbb-1fb8-42e8-807d-036382903df3" />



🗂️ **New Feature: Folder Grid Preview** 
Want to see all your molecules at a glance? You can now generate a beautiful, responsive gallery of all 3D molecules in a specific folder. 
Just use this code block:
````markdown
```3dmol-grid
folder: Assets/Molecules
```
````
example:
<img width="829" height="782" alt="Image" src="https://github.com/user-attachments/assets/c736fa80-7824-4715-b2d0-ca3ed2e22830" />



## Usage

### Embed molecular files

Embed a supported file directly in your note:

```markdown
![[hemoglobin.pdb]]

![[caffeine.sdf]]
```

ChemRender3D automatically replaces the file embed with an interactive 3D viewer.

### Set the viewer size

Use Obsidian's usual embed size suffix, in pixels:

```markdown
![[hemoglobin.pdb|200x500]]   <!-- 200 px wide, 500 px high -->

![[hemoglobin.pdb|300]]       <!-- 300 px wide, default height -->
```

As with images, a width on its own leaves the height alone — the viewer keeps the
**Viewer Height** from the plugin settings. The same suffix works inside `3dmol`,
`2dmol` and `file:` links:

````markdown
```3dmol
[[aspirin.mol|640x480]]
```
````

### Embed a saved Mol* session

A session saved from the Mol* viewer (**State → Download** in Mol*, or the *Save State* control) can be
dropped into the vault and embedded like any other structure file:

```markdown
![[binding-site.molx]]
```

The session restores its own structures, representations, colour themes, background and camera, so the
viewer reproduces the scene as it was saved rather than applying the plugin's default preset. Both the
zipped `.molx` and the plain-JSON `.molj` form work.

If the session contains more than one snapshot, `‹ 1/4 ›` buttons appear in the viewer toolbar for
stepping through them.

Sessions are 3D only — they carry no flat atom list, so `2dmol` and `2d-grid` skip them.

### Generate a structure from SMILES

Use a `3dmol` code block:

````markdown
```3dmol
CC(=O)OC1=CC=CC=C1C(=O)O
```
````

Note: The 3D coordinates from SMILES are generated for visualization and are not intended for geometry optimization or computational analysis.

### Reference a file

Alternatively, reference a molecular file inside a `3dmol` block:

````markdown
```3dmol
[[aspirin.mol]]
```
````

## Settings

* **Max Pixel Ratio** — Reduce this value on high-resolution displays to improve rendering performance.
* **Auto-Spin** — Automatically rotate embedded structures.

## Installation

1. Open **Settings → Community plugins → Browse**.
2. Search for **ChemRender3D**.
3. Install and enable the plugin.

## Acknowledgment

ChemRender3D is powered by [Mol*](https://molstar.org/), an open-source toolkit for visualization and analysis of large-scale molecular data.
