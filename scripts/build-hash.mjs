import { createHash } from 'crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

export function hashInputs () {
  // Don't hash on _all_ of `package.json` — only the parts that could affect
  // what's written into `lib`. For instance, a version bump without any code
  // changes does not need to force another transpilation.
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const dependencyFields = JSON.stringify({
    dependencies: pkg.dependencies,
    devDependencies: pkg.devDependencies
  });

  const inputs = [
    ...walk('src'),
    'rollup.config.mjs',
    'tsconfig.json'
  ].sort();

  const hash = createHash('sha256');
  hash.update(dependencyFields);
  for (const file of inputs) {
    hash.update(file);
    hash.update(readFileSync(file));
  }
  return hash.digest('hex');
}

function walk (dir) {
  return readdirSync(dir, { recursive: true })
    .map((f) => join(dir, f))
    .filter((f) => statSync(f).isFile());
}

// A minimal Rollup plugin that will perform this step during builds.
export function writeBuildHash () {
  return {
    name: 'write-build-hash',
    writeBundle () {
      writeFileSync('lib/.build-hash', hashInputs());
    }
  };
}
