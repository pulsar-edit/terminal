import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import json from '@rollup/plugin-json';
import typescript from '@rollup/plugin-typescript';
import { resolve as resolvePath } from 'path';
import { readFileSync } from 'fs';

// This is a preset Rollup configuration file designed for Pulsar community
// packages written in TypeScript. Here's what it gives us:
//
// * All dependencies that use CommonJS are preserved as-is.
// * All dependencies that use ES Modules are bundled and transpiled to
//   CommonJS. (This is necessary because it is impossible for ESM files loaded
//   in Electron's renderer process to have access to anything from a Node
//   environment, whether built-in or NPM.)
// * JSON files can be imported directly with `import` syntax and do not need
//   the "import attribute" clause. This corresponds to CommonJS's ability to
//   `require('foo.json')`.
//
// Read https://www.electronjs.org/docs/latest/tutorial/esm#renderer-process
// for more information about the limitations of ESM in Electron's renderer
// process.
//
// Known caveats:
//
// * Not all ESM can be transpiled to CommonJS. If your module uses top-level
//   `await` or does dynamic importing (via `await import`), Rollup might be
//   unable to transpile it. If so, you'll have to find a workaround or use a
//   different dependency.
//
//   One possible workaround is reverting to an older version of the same
//   dependency. Many popular packages that use newer ES features will have an
//   older version that doesn't rely on those features, and perhaps an even
//   older version that is written in CommonJS.
//
// * We have been unable to find a combination of plugins that makes it
//   possible to use SolidJS (with JSX) in a TypeScript project while also
//   satisfying the constraints above. (See
//   https://docs.solidjs.com/configuration/typescript for more information.)
//   We have managed to make this work for the equivalent toolchain in
//   JavaScript, but the addition of TypeScript seems to complicate things
//   further. Feel free to customize what's here and let us know if you find a
//   configuration that works.
//
export default [{
  input: 'src/terminal.ts',
  output: {
    dir: 'lib',
    format: 'cjs',
    exports: 'auto',
    interop: 'auto',
    sourcemap: true,
    preserveModules: true,
    preserveModulesRoot: 'src'
  },
  plugins: [
    // TEMP: `@xterm/addon-ligatures` is currently half-broken in that it
    // advertises a `main` field in its `package.json` (and does not specify
    // `type: "module"`) yet the `main` field points to a nonexistent path.
    // Rollup infers that this package supports CommonJS and automatically
    // treats it as external, even if we don't include it in the `externals`
    // list below, because of our `commonjs` plugin config. So it's doomed to
    // fail to be `require`d at runtime.
    //
    // In order to get Rollup _not_ to treat this package as external, we must
    // manually point it to the package's `module` entry. That's what this
    // temporary "plugin" does. Ideally we won't need this fix for long.
    //
    // Since the transpiled output would ordinarily be placed in
    // `lib/node_modules`, it would be ignored by version control; hence we
    // also do some magic to get it to show up at a different path. If we
    // needed to transpile any other modules, this would be a major headache,
    // so we should fix this another way should the need arise.
    //
    // Issue: https://github.com/xtermjs/xterm.js/issues/5822
    {
      name: 'fix-addon-ligatures',
      resolveId (id) {
        if (id === '@xterm/addon-ligatures') {
          return `\0addon-ligatures`;
        }
      },
      load (id) {
        if (id === '\0addon-ligatures') {
          return readFileSync(resolvePath('node_modules/@xterm/addon-ligatures/lib/addon-ligatures.mjs'), 'utf8');
        }
      },
    },
    resolve({
      extensions: ['.js', '.ts', '.json'],
      preferBuiltins: true,
      mainFields: ['module'],
      // Enforces that only ES modules are found; CommonJS modules are treated
      // as external. This saves us from having to transpile them or needlessly
      // include them in the bundle.
      modulesOnly: true
    }),
    commonjs({
      include: /node_modules/,
      // Enable transformations of ES modules in `node_modules`.
      transformMixedEsModules: true,
      // Handle requiring JSON files.
      ignoreDynamicRequires: false
    }),
    typescript({
      tsconfig: './tsconfig.json',
      sourceMap: true
    }),
    json()
  ],
  // Mark certain packages as external; this tells Rollup not to try to
  // transpile or bundle this package's code. CommonJS modules should
  // automatically be treated as external, but you can manually specify any
  // further package you want to make external if you know what you're doing.
  external: [
    '@electron/remote',
    '@xterm/addon-web-links',
    '@xterm/addon-fit',
    // '@xterm/addon-ligatures',
    '@xterm/addon-search',
    '@xterm/addon-webgl',
    '@xterm/xterm',
    'atom',
    'etch',
    'fs-extra',
    'ndjson',
    'tslib',
    'which'
  ]
},
{
  input: 'src/worker/pty.ts',
  output: {
    file: 'lib/worker/pty.js',
    format: 'cjs',
    exports: 'auto',
    interop: 'auto',
    sourcemap: true
  },
  plugins: [
    resolve({
      extensions: ['.js', '.ts', '.json'],
      preferBuiltins: true,
      mainFields: ['module'],
      // Enforces that only ES modules are found; CommonJS modules are treated
      // as external. This saves us from having to transpile them or needlessly
      // include them in the bundle.
      modulesOnly: true
    }),
    commonjs({
      include: /node_modules/,
      // Enable transformations of ES modules in `node_modules`.
      transformMixedEsModules: true,
      // Handle requiring JSON files.
      ignoreDynamicRequires: false
    }),
    typescript({
      tsconfig: './tsconfig.json',
      sourceMap: true,
      declaration: false,
      declarationMap: false
    }),
    json()
  ],
  // Mark certain packages as external; this tells Rollup not to try to
  // transpile or bundle this package's code. CommonJS modules should
  // automatically be treated as external, but you can manually specify any
  // further package you want to make external if you know what you're doing.
  external: [
    'ndjson',
    'node-pty',
    'tslib'
  ]
}];
