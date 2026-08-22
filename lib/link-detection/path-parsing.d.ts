export interface ILinkPartialRange {
    index: number;
    text: string;
}
export interface ILinkSuffix {
    row: number | undefined;
    col: number | undefined;
    rowEnd: number | undefined;
    colEnd: number | undefined;
    suffix: ILinkPartialRange;
}
export interface IParsedLink {
    path: ILinkPartialRange;
    prefix?: ILinkPartialRange;
    suffix?: ILinkSuffix;
}
export declare const winDrivePrefix = "(?:\\\\\\\\\\?\\\\|file:\\/\\/\\/)?[a-zA-Z]:";
export declare function detectLinks(line: string, forWindows: boolean): IParsedLink[];
export declare const fallbackPathMatchers: RegExp[];
export declare const MAX_LINE_LENGTH = 2000;
export declare const MAX_RESOLVED_LINKS_PER_LINE = 10;
export declare const MAX_RESOLVED_LINK_LENGTH = 1024;
