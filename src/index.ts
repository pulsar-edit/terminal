// import { CompositeDisposable } from 'atom';
//
// // import { ProfileData } from './profiles';
// // import { Terminal } from './terminal';
// import { TerminalModel } from './model';
// import { TerminalElement } from './element';
//
// class TerminalPackage {
//
//   // private profiles: ProfileData;
//
//   private disposables = new CompositeDisposable();
//   private terminals = new Set<TerminalModel>();
//
//   activate (_state: unknown) {
//     // for (let data of CONFIG_DATA) {
//     //   this.disposables.add(
//     //     atom.config.onDidChange(
//     //       data.keyPath,
//     //       () => this.onDidChangeConfig()
//     //     )
//     //   )
//     // }
//
//     this.disposables.add(
//       atom.views.addViewProvider(
//         TerminalModel,
//         (model) => {
//           let element = new TerminalElement();
//           if (!TerminalModel.is(model)) {
//             throw new Error('Not a terminal model!');
//           }
//           element.initialize(model);
//           return element;
//         }
//       ),
//
//     )
//   }
//
//   constructor() {
//
//   }
//
//   onDidChangeConfig () {
//     // this.profiles.resetBaseProfile();
//   }
// }
