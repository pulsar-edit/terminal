const path = require('path');

async function activatePackage () {
  addToPackagePaths();
  let promise = atom.packages.activatePackage('terminal');
  atom.packages.triggerActivationHook('core:loaded-shell-environment');
  atom.packages.triggerDeferredActivationHooks();
  await promise;
}

function addToPackagePaths () {
  let packagePath = path.resolve(__dirname, '..', '..');
  if (!atom.packages.packageDirPaths.includes(packagePath)) {
    atom.packages.packageDirPaths.push(packagePath);
  }
}

async function wait (ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitFor (conditionFn, intervalMs = 50, timeoutMs = 5000) {
  let startedAt = Date.now();
  let satisfied = false;
  satisfied = !!conditionFn();
  while (!satisfied) {
    let now = Date.now();
    if (now - startedAt > timeoutMs) {
      throw new Error(`Timeout of ${timeoutMs} exceeded`);
    }
    await wait(intervalMs);
    satisfied = !!conditionFn();
  }
}

module.exports = {
  activatePackage,
  addToPackagePaths,
  wait,
  waitFor
};
