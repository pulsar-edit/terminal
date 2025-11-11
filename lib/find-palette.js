'use strict';

var etch = require('etch');
var atom$1 = require('atom');
var themes = require('./themes.js');
var utils = require('./utils.js');

function _interopDefault (e) { return e && e.__esModule ? e : { default: e }; }

var etch__default = /*#__PURE__*/_interopDefault(etch);

const $ = etch__default.default.dom;
class FindPalette {
    getDecorationsOptions() {
        let root = getComputedStyle(document.documentElement);
        let options = {
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
        };
        return options;
    }
    constructor(searchAddon) {
        this.visible = false;
        this.term = '';
        this.resultCount = 0;
        this.resultIndex = -1;
        this.observedEditors = new WeakSet();
        this.subscriptions = new atom$1.CompositeDisposable();
        this.searchAddon = searchAddon;
        etch__default.default.initialize(this);
        this.searchAddon.onDidChangeResults((event) => {
            this.update({
                resultIndex: event.resultIndex,
                resultCount: event.resultCount
            });
        });
        let debouncedUpdateSearchTheme = utils.debounce(() => this.searchTheme = themes.getSearchTheme());
        // Cache the theme colors that relate to the find palette…
        this.searchTheme = themes.getSearchTheme();
        // …but invalidate the cache whenever the settings change.
        this.subscriptions.add(atom.config.onDidChange('terminal.appearance', debouncedUpdateSearchTheme), atom.themes.onDidChangeActiveThemes(debouncedUpdateSearchTheme), atom.styles.onDidAddStyleElement(debouncedUpdateSearchTheme));
    }
    search(term) {
        this.searchAddon.findNext(term, { decorations: this.searchTheme });
        let text = this.refs.search.getText();
        if (text !== term) {
            this.refs.search.setText(term);
        }
        this.term = term;
    }
    async show() {
        await this.update({ visible: true });
        this.refs.search.getElement().focus();
        this.refs.search.selectAll();
    }
    hide() {
        this.searchAddon.clearDecorations();
        this.update({ visible: false });
    }
    async toggle() {
        await this.update({ visible: !this.visible });
        if (this.visible) {
            this.refs.search.getElement().focus();
            this.refs.search.selectAll();
        }
    }
    findNext() {
        if (this.resultCount === 0)
            return false;
        if (!this.term)
            return false;
        this.searchAddon.findNext(this.term, { decorations: this.searchTheme });
    }
    findPrevious() {
        if (this.resultCount === 0)
            return false;
        if (!this.term)
            return false;
        this.searchAddon.findPrevious(this.term, { decorations: this.searchTheme });
    }
    async update({ term, visible, resultCount, resultIndex }) {
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
        return changed ? etch__default.default.update(this) : Promise.resolve();
    }
    destroy() {
        this.subscriptions.dispose();
    }
    readAfterUpdate() {
        let editor = this.refs.search;
        if (!editor || this.observedEditors.has(editor))
            return;
        this.subscriptions.add(editor.onDidChange(() => {
            let search = editor.getText();
            this.update({ term: search });
        }));
        this.observedEditors.add(editor);
    }
    render() {
        if (!this.visible) {
            // return null;
            return ($.div({ ref: 'element', className: 'terminal-find-palette tool-panel', hidden: true }));
        }
        let resultCountElement = null;
        if (this.resultCount > 0) {
            resultCountElement = $.div({ className: 'terminal-find-palette__result-count' }, `${this.resultIndex + 1} of ${this.resultCount}`);
        }
        let result = ($.div({ ref: 'element', className: 'terminal-find-palette tool-panel' }, $.div({ className: 'terminal-find-palette__label' }, 'Find:'), $(atom$1.TextEditor, {
            mini: true,
            ref: 'search',
            placeholderText: 'Query',
            readOnly: false
        }), resultCountElement, $.i({
            ref: 'btnClose',
            onclick: () => this.hide(),
            className: 'terminal-find-palette__btn-close icon icon-x clickable'
        })));
        return result;
    }
}

module.exports = FindPalette;
//# sourceMappingURL=find-palette.js.map
