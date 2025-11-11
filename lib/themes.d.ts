import { ISearchDecorationOptions } from "@xterm/addon-search";
import type { ITheme } from '@xterm/xterm';
export declare function getTheme(): ITheme;
export declare function getSearchTheme(): ISearchDecorationOptions;
export declare const THEME_COLORS: ({
    name: string;
    description: string;
    short: string;
    default: string;
} | {
    name: string;
    default: string;
    description?: undefined;
    short?: undefined;
} | {
    name: string;
    short: string;
    default: string;
    description?: undefined;
})[];
