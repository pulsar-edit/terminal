'use strict';

var config = require('./config.js');

function getTheme() {
    let theme = config.Config.get('appearance.theme');
    let customThemeColors = config.Config.get('appearance.customThemeColors');
    // Start with the custom colors as a base. Some of these hard-coded themes
    // will override the custom colors and others won't.
    let colors = { ...customThemeColors };
    switch (theme) {
        case "Atom Dark":
            colors.background = "#1d1f21";
            colors.foreground = "#c5c8c6";
            colors.selectionForeground = "#999999";
            colors.cursor = "#ffffff";
            break;
        case "Atom Light":
            colors.background = "#ffffff";
            colors.foreground = "#555555";
            colors.selectionForeground = "#afc4da";
            colors.cursor = "#000000";
            break;
        case "Base16 Tomorrow Dark":
            colors.background = "#1d1f21";
            colors.foreground = "#c5c8c6";
            colors.selectionForeground = "#b4b7b4";
            //  '#e0e0e0';
            colors.cursor = "#ffffff";
            break;
        case "Base16 Tomorrow Light":
            colors.background = "#ffffff";
            colors.foreground = "#1d1f21";
            colors.selectionForeground = "#282a2e";
            //  '#e0e0e0';
            colors.cursor = "#1d1f21";
            break;
        case "Christmas":
            colors.background = "#0c0047";
            colors.foreground = "#f81705";
            colors.selectionForeground = "#298f16";
            colors.cursor = "#009f59";
            break;
        case "City Lights":
            colors.background = "#181d23";
            colors.foreground = "#666d81";
            colors.selectionForeground = "#2a2f38";
            //  '#b7c5d3';
            colors.cursor = "#528bff";
            break;
        case "Dracula":
            colors.background = "#1e1f29";
            colors.foreground = "white";
            colors.selectionForeground = "#44475a";
            colors.cursor = "#999999";
            break;
        case "Grass":
            colors.background = "rgb(19, 119, 61)";
            colors.foreground = "rgb(255, 240, 165)";
            colors.selectionForeground = "rgba(182, 73, 38, .99)";
            colors.cursor = "rgb(142, 40, 0)";
            break;
        case "Homebrew":
            colors.background = "#000000";
            colors.foreground = "rgb(41, 254, 20)";
            colors.selectionForeground = "rgba(7, 30, 155, .99)";
            colors.cursor = "rgb(55, 254, 38)";
            break;
        case "Inverse":
            colors.background = "#ffffff";
            colors.foreground = "#000000";
            colors.selectionForeground = "rgba(178, 215, 255, .99)";
            colors.cursor = "rgb(146, 146, 146)";
            break;
        case "Linux":
            colors.background = "#000000";
            colors.foreground = "rgb(230, 230, 230)";
            colors.selectionForeground = "rgba(155, 30, 7, .99)";
            colors.cursor = "rgb(200, 20, 25)";
            break;
        case "Man Page":
            colors.background = "rgb(254, 244, 156)";
            colors.foreground = "black";
            colors.selectionForeground = "rgba(178, 215, 255, .99)";
            colors.cursor = "rgb(146, 146, 146)";
            break;
        case "Novel":
            colors.background = "rgb(223, 219, 196)";
            colors.foreground = "rgb(77, 47, 46)";
            colors.selectionForeground = "rgba(155, 153, 122, .99)";
            colors.cursor = "rgb(115, 99, 89)";
            break;
        case "Ocean":
            colors.background = "rgb(44, 102, 201)";
            colors.foreground = "white";
            colors.selectionForeground = "rgba(41, 134, 255, .99)";
            colors.cursor = "rgb(146, 146, 146)";
            break;
        case "One Dark":
            colors.background = "#282c34";
            colors.foreground = "#abb2bf";
            colors.selectionForeground = "#9196a1";
            colors.cursor = "#528bff";
            break;
        case "One Light":
            colors.background = "hsl(230, 1%, 98%)";
            colors.foreground = "hsl(230, 8%, 24%)";
            colors.selectionForeground = "hsl(230, 1%, 90%)";
            colors.cursor = "hsl(230, 100%, 66%)";
            break;
        case "Predawn":
            colors.background = "#282828";
            colors.foreground = "#f1f1f1";
            colors.selectionForeground = "rgba(255,255,255,0.25)";
            colors.cursor = "#f18260";
            break;
        case "Pro":
            colors.background = "#000000";
            colors.foreground = "rgb(244, 244, 244)";
            colors.selectionForeground = "rgba(82, 82, 82, .99)";
            colors.cursor = "rgb(96, 96, 96)";
            break;
        case "Red Sands":
            colors.background = "rgb(143, 53, 39)";
            colors.foreground = "rgb(215, 201, 167)";
            colors.selectionForeground = "rgba(60, 25, 22, .99)";
            colors.cursor = "white";
            break;
        case "Red":
            colors.background = "#000000";
            colors.foreground = "rgb(255, 38, 14)";
            colors.selectionForeground = "rgba(7, 30, 155, .99)";
            colors.cursor = "rgb(255, 38, 14)";
            break;
        case "Silver Aerogel":
            colors.background = "rgb(146, 146, 146)";
            colors.foreground = "#000000";
            colors.selectionForeground = "rgba(120, 123, 156, .99)";
            colors.cursor = "rgb(224, 224, 224)";
            break;
        case "Solarized Dark":
            colors.background = "#042029";
            colors.foreground = "#708284";
            colors.selectionForeground = "#839496";
            colors.cursor = "#819090";
            break;
        case "Solarized Light":
            colors.background = "#fdf6e3";
            colors.foreground = "#657a81";
            colors.selectionForeground = "#ece7d5";
            colors.cursor = "#586e75";
            break;
        case "Solid Colors":
            colors.background = "rgb(120, 132, 151)";
            colors.foreground = "#000000";
            colors.selectionForeground = "rgba(178, 215, 255, .99)";
            colors.cursor = "#ffffff";
            break;
        case "Standard": {
            let root = getComputedStyle(document.documentElement);
            colors.background = root.getPropertyValue("--standard-app-background-color");
            colors.foreground = root.getPropertyValue("--standard-text-color");
            colors.selectionForeground = root.getPropertyValue("--standard-background-color-selected");
            colors.cursor = root.getPropertyValue("--standard-text-color-highlight");
            colors.black = root.getPropertyValue("--standard-color-black");
            colors.red = root.getPropertyValue("--standard-color-red");
            colors.green = root.getPropertyValue("--standard-color-green");
            colors.yellow = root.getPropertyValue("--standard-color-yellow");
            colors.blue = root.getPropertyValue("--standard-color-blue");
            colors.magenta = root.getPropertyValue("--standard-color-magenta");
            colors.cyan = root.getPropertyValue("--standard-color-cyan");
            colors.white = root.getPropertyValue("--standard-color-white");
            colors.brightBlack = root.getPropertyValue("--standard-color-bright-black");
            colors.brightRed = root.getPropertyValue("--standard-color-bright-red");
            colors.brightGreen = root.getPropertyValue("--standard-color-bright-green");
            colors.brightYellow = root.getPropertyValue("--standard-color-bright-yellow");
            colors.brightBlue = root.getPropertyValue("--standard-color-bright-blue");
            colors.brightMagenta = root.getPropertyValue("--standard-color-bright-magenta");
            colors.brightCyan = root.getPropertyValue("--standard-color-bright-cyan");
            colors.brightWhite = root.getPropertyValue("--standard-color-bright-white");
            break;
        }
        case 'Stylesheet': {
            let root = getComputedStyle(document.documentElement);
            colors.background = root.getPropertyValue("--terminal-background-color");
            colors.foreground = root.getPropertyValue("--terminal-text-color");
            colors.selectionBackground = root.getPropertyValue("--terminal-selection-background-color");
            colors.selectionForeground = root.getPropertyValue("--terminal-selection-text-color");
            colors.cursor = root.getPropertyValue("--terminal-cursor-color");
            colors.black = root.getPropertyValue("--terminal-color-black");
            colors.red = root.getPropertyValue("--terminal-color-red");
            colors.green = root.getPropertyValue("--terminal-color-green");
            colors.yellow = root.getPropertyValue("--terminal-color-yellow");
            colors.blue = root.getPropertyValue("--terminal-color-blue");
            colors.magenta = root.getPropertyValue("--terminal-color-magenta");
            colors.cyan = root.getPropertyValue("--terminal-color-cyan");
            colors.white = root.getPropertyValue("--terminal-color-white");
            colors.brightBlack = root.getPropertyValue("--terminal-color-bright-black");
            colors.brightRed = root.getPropertyValue("--terminal-color-bright-red");
            colors.brightGreen = root.getPropertyValue("--terminal-color-bright-green");
            colors.brightYellow = root.getPropertyValue("--terminal-color-bright-yellow");
            colors.brightBlue = root.getPropertyValue("--terminal-color-bright-blue");
            colors.brightMagenta = root.getPropertyValue("--terminal-color-bright-magenta");
            colors.brightCyan = root.getPropertyValue("--terminal-color-bright-cyan");
            colors.brightWhite = root.getPropertyValue("--terminal-color-bright-white");
            break;
        }
        case 'Config':
            // Do nothing; we're using the custom colors as-is.
            break;
        default:
            console.warn(`[terminal] Unrecognized theme value: ${theme}`);
    }
    return colors;
}

exports.getTheme = getTheme;
//# sourceMappingURL=themes.js.map
