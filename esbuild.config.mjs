import esbuild from "esbuild";
import process from "node:process";
import { builtinModules } from "node:module";

const prod = process.argv[2] === "production";

esbuild
    .build({
        entryPoints: ["main.ts"],
        bundle: true,
        format: "cjs",
        target: "es2018",

        external: [
            "obsidian",
            "electron",
            "jsdom",
            "canvas",

            "@codemirror/autocomplete",
            "@codemirror/collab",
            "@codemirror/commands",
            "@codemirror/language",
            "@codemirror/lint",
            "@codemirror/search",
            "@codemirror/state",
            "@codemirror/view",

            "@lezer/common",
            "@lezer/highlight",
            "@lezer/lr",

            ...builtinModules,
            ...builtinModules.map((m) => `node:${m}`),
        ],

        logLevel: "info",
        sourcemap: prod ? false : "inline",
        treeShaking: true,
        outfile: "main.js",
        
        // Mol* requires CSS styling. Esbuild will automatically bundle 
        // imported .css or .scss files into a main.css file alongside main.js.
        // Ensure you import Mol*'s styles in your main.ts file.
    })
    .catch(() => process.exit(1));