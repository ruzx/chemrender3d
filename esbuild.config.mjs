import esbuild from "esbuild";
import process from "process";
import fs from "fs";
import path from "path";
import builtinModules from "module"; // <-- Using Node's native module here

const prod = (process.argv[2] === "production");

// OBSIDIAN STORE FIX: 
// This plugin intercepts the final build and neuters the dynamic <script> 
// element creations hidden inside the third-party Molstar library.
const sanitizeObsidianPlugin = {
    name: 'sanitize-obsidian',
    setup(build) {
        build.onEnd(() => {
            const outPath = path.join(process.cwd(), 'main.js');
            if (fs.existsSync(outPath)) {
                let content = fs.readFileSync(outPath, 'utf8');
                
                // Replace any dynamic script creations with standard spans
                content = content.replace(/createElement\(\s*['"`]script['"`]\s*\)/gi, "createElement('span')");
                
                fs.writeFileSync(outPath, content);
            }
        });
    }
};

const context = await esbuild.context({
    entryPoints: ["main.ts"],
    bundle: true,
    external: [
        "obsidian",
        "electron",
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
        ...builtinModules.builtinModules // <-- Updated here
    ],
    format: "cjs",
    target: "es2018",
    logLevel: "info",
    sourcemap: prod ? false : "inline",
    treeShaking: true,
    outdir: ".",
    // FORCE minification in production to fix the "larger than 5 MB" warning
    minify: prod, 
    plugins: [sanitizeObsidianPlugin], // Inject our sanitizer
});

if (prod) {
    await context.rebuild();
    process.exit(0);
} else {
    await context.watch();
}