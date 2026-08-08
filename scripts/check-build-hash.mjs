import { readFileSync } from 'fs';
import { hashInputs } from './build-hash.mjs';

let stored;
try {
  stored = readFileSync('lib/.build-hash', 'utf8');
} catch {
  // If no hash is on record, assume the output is stale.
  process.exit(1);
}

let currentHash = hashInputs();

let isFresh = stored === currentHash;

if (!isFresh) {
  console.log('Stale output; rebuilding…');
} else {
  console.log('Output is fresh; no build needed.');
}

process.exit(stored === hashInputs() ? 0 : 1);
