import type { ISearchDecorationOptions, SearchAddon } from '@xterm/addon-search';
import etch from 'etch';
import { CompositeDisposable, TextEditor } from 'atom';
import { getSearchTheme } from './themes';
import { debounce } from './utils';
import { EtchJSXElement } from '../types/etch/etch-element';

const $ = etch.dom;

type FindPaletteProperties = {
  term: string;
  visible: boolean;
  resultCount: number;
  resultIndex: number;
}

export default class FindPalette {
  private searchAddon: SearchAddon;

  public visible: boolean = false;

  public term: string = '';
  public resultCount: number = 0;
  public resultIndex: number = -1;

  public element!: HTMLElement;
  public refs!: {
    [key: string]: HTMLElement
  } & { search: TextEditor };

  private observedEditors: WeakSet<TextEditor> = new WeakSet();
  private subscriptions: CompositeDisposable = new CompositeDisposable();

  private searchTheme: ISearchDecorationOptions;

  getDecorationsOptions () {
    let root = getComputedStyle(document.documentElement);
    let options: ISearchDecorationOptions = {
      // These are required in the decorations object (typedef bug?) but we
      // aren't using them, so we're specifying transparent color values.
      matchOverviewRuler: `#00000000`,
      activeMatchColorOverviewRuler: `#00000000`,

      // TODO: These get specified by the stylesheet. There's not currently an
      // analog to this approach if a user chooses to define colors via the
      // config system; that should be fixed.
      matchBorder: root.getPropertyValue('--terminal-result-marker-color'),
      activeMatchBorder: root.getPropertyValue('--terminal-result-marker-color-selected'),
      matchBackground: root.getPropertyValue('--terminal-background-color'),
      activeMatchBackground: root.getPropertyValue('--terminal-selection-background-color')
    }
    return options;
  }

  constructor (searchAddon: SearchAddon) {
    this.searchAddon = searchAddon;
    etch.initialize(this);

    this.searchAddon.onDidChangeResults((event) => {
      this.update({
        resultIndex: event.resultIndex,
        resultCount: event.resultCount
      });
    });

    let debouncedUpdateSearchTheme = debounce(
      () => this.searchTheme = getSearchTheme()
    );

    // Cache the theme colors that relate to the find palette…
    this.searchTheme = getSearchTheme();

    // …but invalidate the cache whenever the settings change.
    this.subscriptions.add(
      atom.config.onDidChange('terminal.appearance', debouncedUpdateSearchTheme),
      atom.themes.onDidChangeActiveThemes(debouncedUpdateSearchTheme),
      atom.styles.onDidAddStyleElement(debouncedUpdateSearchTheme)
    );
  }

  search (term: string) {
    this.searchAddon.findNext(term, { decorations: this.searchTheme });
    let text = this.refs.search.getText();
    if (text !== term) {
      this.refs.search.setText(term);
    }
    this.term = term;
  }

  async show () {
    await this.update({ visible: true });
    this.refs.search.getElement().focus();
    this.refs.search.selectAll();
  }

  hide () {
    this.searchAddon.clearDecorations();
    this.update({ visible: false });
  }

  async toggle () {
    await this.update({ visible: !this.visible });
    if (this.visible) {
      this.refs.search.getElement().focus();
      this.refs.search.selectAll();
    }
  }

  findNext () {
    if (this.resultCount === 0) return false;
    if (!this.term) return false;
    this.searchAddon.findNext(this.term, { decorations: this.searchTheme });
  }

  findPrevious () {
    if (this.resultCount === 0) return false;
    if (!this.term) return false;
    this.searchAddon.findPrevious(this.term, { decorations: this.searchTheme });
  }

  async update ({ term, visible, resultCount, resultIndex }: Partial<FindPaletteProperties>) {
    let changed = false;

    if (term !== undefined && this.term !== term) {
      changed = true;
      this.search(term);
    }

    if (visible !== undefined && this.visible !== visible) {
      changed = true;
      this.visible = visible;
    }

    if (typeof resultCount === 'number' && this.resultCount !== resultCount) {
      changed = true;
      this.resultCount = resultCount;
    }

    if (typeof resultIndex === 'number' && this.resultIndex !== resultIndex) {
      changed = true;
      this.resultIndex = resultIndex;
    }

    return changed ? etch.update(this) : Promise.resolve();
  }

  destroy () {
    this.subscriptions.dispose();
  }

  readAfterUpdate () {
    let editor = this.refs.search;
    if (!editor || this.observedEditors.has(editor)) return;
    this.subscriptions.add(
      editor.onDidChange(() => {
        let search = editor.getText();
        this.update({ term: search });
      })
    )
    this.observedEditors.add(editor);
  }

  render () {
    if (!this.visible) {
      // return null;
      return (
        $.div({ ref: 'element', className: 'terminal-find-palette tool-panel', hidden: true })
      );
    }

    let resultCountElement: EtchJSXElement | null = null;
    if (this.resultCount > 0) {
      resultCountElement = $.div(
        { className: 'terminal-find-palette__result-count' },
        `${this.resultIndex + 1} of ${this.resultCount}`
      );
    }

    let result = (
      $.div({ ref: 'element', className: 'terminal-find-palette tool-panel' },
        $.div({ className: 'terminal-find-palette__label' }, 'Find:'),
        $(TextEditor, {
          mini: true,
          ref: 'search',
          placeholderText: 'Query',
          readOnly: false
        }),
        resultCountElement,
        $.i({
          ref: 'btnClose',
          onclick: () => this.hide(),
          className: 'terminal-find-palette__btn-close icon icon-x clickable'
        })
      )
    );

    return result;
  }
}
