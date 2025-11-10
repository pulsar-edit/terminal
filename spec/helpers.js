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

module.exports = {
  activatePackage,
  addToPackagePaths,
  wait
};
