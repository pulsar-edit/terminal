import type { ISearchDecorationOptions, SearchAddon } from '@xterm/addon-search';
import { TextEditor } from 'atom';
import { EtchJSXElement } from '../types/etch/etch-element';
type FindPaletteProperties = {
    term: string;
    visible: boolean;
    resultCount: number;
    resultIndex: number;
};
export default class FindPalette {
    private searchAddon;
    visible: boolean;
    term: string;
    resultCount: number;
    resultIndex: number;
    element: HTMLElement;
    refs: {
        [key: string]: HTMLElement;
    } & {
        search: TextEditor;
    };
    private observedEditors;
    private subscriptions;
    private searchTheme;
    getDecorationsOptions(): ISearchDecorationOptions;
    constructor(searchAddon: SearchAddon);
    search(term: string): void;
    show(): Promise<void>;
    hide(): void;
    toggle(): Promise<void>;
    findNext(): false | undefined;
    findPrevious(): false | undefined;
    update({ term, visible, resultCount, resultIndex }: Partial<FindPaletteProperties>): Promise<void>;
    destroy(): void;
    readAfterUpdate(): void;
    render(): EtchJSXElement;
}
export {};
