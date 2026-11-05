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
* **Molecular orbitals** — Show the HOMO, LUMO or any other orbital of a small molecule, computed right in your note, or load real quantum-chemistry results from `.molden` files.



📝 Release Notes

**⚡ (1.0.6)**
* **Molecular orbitals for any small molecule** — A new orbital button computes the molecular orbitals in the note with Extended Hückel theory, the classic qualitative MO method from organic-chemistry teaching. No files or external software needed.
* **MO energy diagram** — Occupied levels with ↑↓ electrons, HOMO/LUMO and the gap, and which atoms each orbital lives on. Click a level to draw it in its two phases (blue/red), show the total electron density (**ρ**), or resize the lobes.
* **`.molden` support** — Embed orbitals from xtb, ORCA, PySCF or Psi4 calculations.
* **New `3dmol` options** — `orbital:`, `iso:` and `charge:`.
* **Fixes** — The *Show UI panels* setting is now respected, so Mol*'s side panels stay hidden by default. Also fixed: XYZ files with a blank comment line lost their first atom; SMILES lookups now use PubChem's SMILES endpoint; MOL/SDF files with 100+ atoms or bonds now parse; formal charges are read from SDF files; inline styles on 2D cards and grids are now applied.





**⚡ (1.0.5)**
* **Mol\* sessions** — Embed a `.molx` or `.molj` session and get back exactly the scene you saved. (Thanks @lkndl!)
* **Sized embeds** — Set a viewer's width and height with Obsidian's `|WIDTHxHEIGHT` suffix. (Thanks @lkndl!)

molx/embeds demo:

<img width="800" height="590" alt="molx_stepper" src="https://github.com/user-attachments/assets/acb50e61-53d5-4b49-91f2-a345afedee31" />


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

### Show molecular orbitals

Every small-molecule viewer has an **orbital button** (the two-lobe icon in the toolbar). Click it to compute the
orbitals and open the energy-level diagram. Click any level to draw that orbital; **▲ ▼** step through them,
**ρ** shows the total electron density, and **Size** changes the contour.

To open a viewer straight on an orbital, add `orbital:` to a `3dmol` block:

````markdown
```3dmol
pubchem: ibuprofen
orbital: HOMO
```
````

````markdown
```3dmol
smiles: C=CC=CC=C
orbital: LUMO
iso: 0.8
```
````

| Option | Values |
|---|---|
| `orbital:` | `HOMO`, `LUMO`, `HOMO-2`, `LUMO+1`, `density`, a 1-based MO number, or `true` |
| `iso:` | Contour size: `1` is automatic, smaller values draw bigger lobes |
| `charge:` | Total charge, if it is not in the SDF file (`M  CHG` lines are read automatically) |

The orbitals come from **Extended Hückel theory**, a qualitative method. Orbital shapes, nodes and HOMO/LUMO
character are reliable for ordinary organic molecules, which is what you need for teaching. Energies are
approximate, and levels that are close in energy can come out in a different order than in a full quantum
calculation. Supported elements: H, B, C, N, O, F, Si, P, S, Cl, Br, I. Structures need explicit hydrogens;
PubChem and SMILES lookups already include them.

### Embed orbitals from a quantum-chemistry calculation

For real computed orbitals, embed a Molden file:

```markdown
![[water.molden]]
```

or use `file: [[water.molden]]` together with `orbital:` in a `3dmol` block. The orbital panel opens
automatically and shows your calculation's orbitals and energies. Most programs can write a Molden file:

| Program | How |
|---|---|
| xtb | `xtb mol.xyz --molden`, then rename `molden.input` to `mol.molden` |
| ORCA | `orca_2mkl job -molden`, then rename `job.molden.input` to `job.molden` |
| PySCF | `from pyscf.tools import molden; molden.from_scf(mf, 'mol.molden')` |
| Psi4 | `psi4.molden(wfn, 'mol.molden')` |

Spherical s–g functions and Cartesian d functions are supported. For Cartesian f or g functions, ask the
program for spherical output.

## Settings

* **Max Pixel Ratio** — Reduce this value on high-resolution displays to improve rendering performance.
* **Auto-Spin** — Automatically rotate embedded structures.
* **Show orbital button** — Add the orbital button to small-molecule viewers.
* **Orbital surface style** — Translucent glow (like the Mol* demo) or solid textbook lobes.
* **Default orbital isovalue** — Default lobe size; override it per block with `iso:`.

## Installation

1. Open **Settings → Community plugins → Browse**.
2. Search for **ChemRender3D**.
3. Install and enable the plugin.

## Acknowledgment

ChemRender3D is powered by [Mol*](https://molstar.org/), an open-source toolkit for visualization and analysis of large-scale molecular data.
