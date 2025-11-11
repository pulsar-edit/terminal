import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import json from '@rollup/plugin-json';
import typescript from '@rollup/plugin-typescript';

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
    '@xterm/addon-ligatures',
    '@xterm/addon-search',
    '@xterm/addon-webgl',
    '@xterm/xterm',
    'atom',
    'etch',
    'fs-extra',
    'ndjson',
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
    'node-pty'
  ]
}];
