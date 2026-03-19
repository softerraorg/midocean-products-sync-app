const fs = require('fs');
const path = require('path');
const simpleColorConverter = require('simple-color-converter');

// Configuration
const INCLUDE_COMMENTS = false; // Set to false to exclude comments from CSS output

// Standard CSS color names (140 colors from W3Schools)
// These are checked as 3rd priority (after PMS library and predefined PMS list)
const cssColors = {
    'aliceblue': '#F0F8FF',
    'antiquewhite': '#FAEBD7',
    'aqua': '#00FFFF',
    'aquamarine': '#7FFFD4',
    'azure': '#F0FFFF',
    'beige': '#F5F5DC',
    'bisque': '#FFE4C4',
    'black': '#000000',
    'blanchedalmond': '#FFEBCD',
    'blue': '#0000FF',
    'blueviolet': '#8A2BE2',
    'brown': '#A52A2A',
    'burlywood': '#DEB887',
    'cadetblue': '#5F9EA0',
    'chartreuse': '#7FFF00',
    'chocolate': '#D2691E',
    'coral': '#FF7F50',
    'cornflowerblue': '#6495ED',
    'cornsilk': '#FFF8DC',
    'crimson': '#DC143C',
    'cyan': '#00FFFF',
    'darkblue': '#00008B',
    'darkcyan': '#008B8B',
    'darkgoldenrod': '#B8860B',
    'darkgray': '#A9A9A9',
    'darkgrey': '#A9A9A9',
    'darkgreen': '#006400',
    'darkkhaki': '#BDB76B',
    'darkmagenta': '#8B008B',
    'darkolivegreen': '#556B2F',
    'darkorange': '#FF8C00',
    'darkorchid': '#9932CC',
    'darkred': '#8B0000',
    'darksalmon': '#E9967A',
    'darkseagreen': '#8FBC8F',
    'darkslateblue': '#483D8B',
    'darkslategray': '#2F4F4F',
    'darkslategrey': '#2F4F4F',
    'darkturquoise': '#00CED1',
    'darkviolet': '#9400D3',
    'deeppink': '#FF1493',
    'deepskyblue': '#00BFFF',
    'dimgray': '#696969',
    'dimgrey': '#696969',
    'dodgerblue': '#1E90FF',
    'firebrick': '#B22222',
    'floralwhite': '#FFFAF0',
    'forestgreen': '#228B22',
    'fuchsia': '#FF00FF',
    'gainsboro': '#DCDCDC',
    'ghostwhite': '#F8F8FF',
    'gold': '#FFD700',
    'goldenrod': '#DAA520',
    'gray': '#808080',
    'grey': '#808080',
    'green': '#008000',
    'greenyellow': '#ADFF2F',
    'honeydew': '#F0FFF0',
    'hotpink': '#FF69B4',
    'indianred': '#CD5C5C',
    'indigo': '#4B0082',
    'ivory': '#FFFFF0',
    'khaki': '#F0E68C',
    'lavender': '#E6E6FA',
    'lavenderblush': '#FFF0F5',
    'lawngreen': '#7CFC00',
    'lemonchiffon': '#FFFACD',
    'lightblue': '#ADD8E6',
    'lightcoral': '#F08080',
    'lightcyan': '#E0FFFF',
    'lightgoldenrodyellow': '#FAFAD2',
    'lightgray': '#D3D3D3',
    'lightgrey': '#D3D3D3',
    'lightgreen': '#90EE90',
    'lightpink': '#FFB6C1',
    'lightsalmon': '#FFA07A',
    'lightseagreen': '#20B2AA',
    'lightskyblue': '#87CEFA',
    'lightslategray': '#778899',
    'lightslategrey': '#778899',
    'lightsteelblue': '#B0C4DE',
    'lightyellow': '#FFFFE0',
    'lime': '#00FF00',
    'limegreen': '#32CD32',
    'linen': '#FAF0E6',
    'magenta': '#FF00FF',
    'maroon': '#800000',
    'mediumaquamarine': '#66CDAA',
    'mediumblue': '#0000CD',
    'mediumorchid': '#BA55D3',
    'mediumpurple': '#9370DB',
    'mediumseagreen': '#3CB371',
    'mediumslateblue': '#7B68EE',
    'mediumspringgreen': '#00FA9A',
    'mediumturquoise': '#48D1CC',
    'mediumvioletred': '#C71585',
    'midnightblue': '#191970',
    'mintcream': '#F5FFFA',
    'mistyrose': '#FFE4E1',
    'moccasin': '#FFE4B5',
    'navajowhite': '#FFDEAD',
    'navy': '#000080',
    'oldlace': '#FDF5E6',
    'olive': '#808000',
    'olivedrab': '#6B8E23',
    'orange': '#FFA500',
    'orangered': '#FF4500',
    'orchid': '#DA70D6',
    'palegoldenrod': '#EEE8AA',
    'palegreen': '#98FB98',
    'paleturquoise': '#AFEEEE',
    'palevioletred': '#DB7093',
    'papayawhip': '#FFEFD5',
    'peachpuff': '#FFDAB9',
    'peru': '#CD853F',
    'pink': '#FFC0CB',
    'plum': '#DDA0DD',
    'powderblue': '#B0E0E6',
    'purple': '#800080',
    'rebeccapurple': '#663399',
    'red': '#FF0000',
    'rosybrown': '#BC8F8F',
    'royalblue': '#4169E1',
    'saddlebrown': '#8B4513',
    'salmon': '#FA8072',
    'sandybrown': '#F4A460',
    'seagreen': '#2E8B57',
    'seashell': '#FFF5EE',
    'sienna': '#A0522D',
    'silver': '#C0C0C0',
    'skyblue': '#87CEEB',
    'slateblue': '#6A5ACD',
    'slategray': '#708090',
    'slategrey': '#708090',
    'snow': '#FFFAFA',
    'springgreen': '#00FF7F',
    'steelblue': '#4682B4',
    'tan': '#D2B48C',
    'teal': '#008080',
    'thistle': '#D8BFD8',
    'tomato': '#FF6347',
    'turquoise': '#40E0D0',
    'violet': '#EE82EE',
    'wheat': '#F5DEB3',
    'white': '#FFFFFF',
    'whitesmoke': '#F5F5F5',
    'yellow': '#FFFF00',
    'yellowgreen': '#9ACD32',

    //Extra fallback colors
    'black-lime': '#32CD32',
    'black-dark-grey': '#3D3935',
    'black-white': '#FFFEF6',
    'camo-royal-blue': '#00263A',
    'copper': '#B87333',
    'cream': '#F5F5F5',
    'deep-black': '#D1E0D7',
    'folk-pink-twin': '#F5B6CD',
    'forest-green-white': '#D1E0D7',
    'french-navy-neon-orange': '#FF8F6C',
    'french-navy-white': '#FFFEF6',
    'grey-melange-french-navy': '#53565A',
    'matt-gold': '#B87333',
    'matt-silver': '#C0C0C0',
    'melange-grey-orange': '#C6AA76',
    'metal-grey': '#808080',
    'navy-royal': '#00263A',
    'neon-lime-royal-blue': '#00263A',
    'recycled-black': '#000000',
    'recycled-navy': '#051C2C',
    'recycled-white': '#FFFEF6',
    'red-white': '#C10016',
    'royal-blue-white': '#051C2C',
    'royal-neon-yellow': '#C0DF16',
    'white-aqua': '#00A3E0',
    'white-navy': '#051C2C',
    'wood': '#D7B187',
    'transparent': '#FBFBFB',
    'transparent-white': '#FFFFFF',
};

// Predefined PMS color mappings (fallback when library conversion fails)
const pmsColors = {
    '296 U': '#041C2C', //296 C
    '7499U': '#F1E6B2', //7499 C
    '7502C': '#CEB888',
    '425C': '#54585A',
    '7519C': '#5E4B3C',
    '7528C': '#C5B9AC',
    '7428U': '#6A2C3E', //7428 C
    'RED 032U': '#EF3340', //Red 032 C
    '7500U': '#DFD1A7', //7500 C
    'WARM GRAY 2C': '#CBC4BC',
    '7535C': '#B7B09C',
    '7502U': '#CEB888', //7502 C
    'WARM GREY 9U': '#83786F', //Warm Gray 9 C
    'COOL GRAY 9C': '#75787B',
    '7539C': '#8E9089',
    '7526C': '#8A391B',
    '7498C': '#5B6236',
    '2338C': '#DEA39C',
    'WHITE C': '#FFFFFF',
    'BLACK': '#000000',
    '426C': '#25282A',
    'COOL GRAY 10C': '#63666A',
    'BLACK 7C': '#3D3935',
    'RED 3517C': '#C10016',
    '7417C': '#E04E39',
    '425C': '#54585A',
    '426C': '#25282A',
    '195C': '#782F40',
    '4294C': '#575257',
    'ORANGE 021C': '#FE5000',
    'PANTONE VIOLET U': '#440099', //PANTONE Violet C
    'BLACK 7C': '#3D3935',
    '296 U': '#041C2C', //296 C
    '#539C': '#00263A',
    '7686C': '#1D4F91',
    'COOL GRAY 11C': '#53565A',
    'COOL GRAY 8C': '#888B8D',
    'COOL GRAY 7C': '#97999B',
    '7472C': '#5CB8B2',
    '7500U': '#DFD1A7', //7500 C
    '7546C': '#253746',
    '296C': '#041C2C',
    '7420C': '#9B2242',
    '2233C': '#58A7AF',
    '2418C': '#00873E',
    '7543C': '#98A4AE',
    '877C': '#8A8D8F',
    '7481C': '#00B74F',
    'COOL GRAY 11C': '#53565A',
    'ORANGE 021U': '#FE5000', //Orange 021 C
    '7687C': '#1D428A',
    '2297C': '#C0DF16',
    'RED 3517C': '#C10016', //3517 C
    '7542C': '#A4BCC2',
    '7544U': '#768692', //7544 C
    '426C + COOL GRAY 10C': '25282A',
    'BLACK 7C/ RED 3517C': '#3D3935',
    '425C + 426C': '#54585A',
    '#539C + 7686C': '#00263A',
    '296C + 9224C': '#041C2C',
    '9224C': '#041C2C',
    'RED 3517C/ WHITE': '#C10016',
    '9224C + 296C': '#041C2C',
    'NEON PINK': '#FF5FA2',
    '8021C': '#B87333', //copper
    'P9-1C': '#F5F5F5', //cream
    'SILVER': '#C0C0C0',
    'WOOD COLOR': '#D1E0D7', //wood
    'WHITE': '#FFFFFF',
    '19-0000 TCX': '#D1E0D7', //recycled-grey-melange
    '19-1761 TCX': '#C10016', //recycled-red
    '19-4053 TCX': '#00263A', //recycled-royal-blue
    'P 8-9C': '#F2EFD9', //natural
    '4C': 'linear-gradient(to right,#f00,#f00 33.33%,#0f0 33.33%,#0f0 66.67%,#00f 66.67%)', //mix color
    'SKIP': 'linear-gradient(to right,#E0D703,#E0D703 50.00%,#E8509C 50.00%)', //multicolour
    

    // Add more predefined PMS colors as needed
    // 'TRANSPARENT': '', //transparent
};

/**
 * Get hex color from predefined PMS colors list
 */
function getPredefinedPmsColor(pmsColor) {
    if (!pmsColor || typeof pmsColor !== 'string') return null;

    const trimmed = pmsColor.trim();
    if (!trimmed) return null;

    // Try exact match first
    if (pmsColors[trimmed]) {
        return pmsColors[trimmed];
    }

    // Try case-insensitive match
    for (const [key, hex] of Object.entries(pmsColors)) {
        if (key.toLowerCase() === trimmed.toLowerCase()) {
            return hex;
        }
    }

    // Try with space variations (e.g., "296U" -> "296 U")
    const withSpace = trimmed.replace(/(\d+)([A-Z])/i, '$1 $2');
    if (pmsColors[withSpace]) {
        return pmsColors[withSpace];
    }

    // Try without space (e.g., "296 U" -> "296U")
    const withoutSpace = trimmed.replace(/\s+/g, '');
    if (pmsColors[withoutSpace]) {
        return pmsColors[withoutSpace];
    }

    return null;
}

/**
 * Convert PMS color to hex
 * Tries multiple formats: "170C", "170 C", "PMS 170C", etc.
 */
function pmsToHex(pmsColor) {
    if (!pmsColor || typeof pmsColor !== 'string') return null;

    const trimmed = pmsColor.trim();
    if (!trimmed) return null;

    // Skip non-PMS values like "SILVER", "BLACK", "WHITE", etc. that are just color names
    const upperTrimmed = trimmed.toUpperCase();
    if (['SILVER', 'BLACK', 'WHITE', 'GOLD', 'GREY', 'GRAY', 'TRANSPARENT', 'SKIP', 'WOOD COLOR'].includes(upperTrimmed)) {
        return null;
    }

    // Try different formats with original code
    const formats = [
        trimmed,                                    // Original: "170C"
        trimmed.replace(/(\d+)([A-Z])/i, '$1 $2'), // Add space: "170 C"
        trimmed.replace(/\s+/g, ''),                // Remove all spaces: "170C"
        `PMS ${trimmed}`,                          // "PMS 170C"
        `PMS ${trimmed.replace(/(\d+)([A-Z])/i, '$1 $2')}`, // "PMS 170 C"
    ];

    // Remove duplicates
    let uniqueFormats = [...new Set(formats)];

    // Try original formats first
    for (const format of uniqueFormats) {
        try {
            const color = new simpleColorConverter({
                pantone: format,
                to: 'hex'
            });

            // Check if conversion was successful
            // Library returns { color: "FF8674" } on success or { error: "...", color: {} } on failure
            if (color && color.color && typeof color.color === 'string' && color.color.length === 6) {
                // Add # prefix if not present
                const hex = color.color.startsWith('#') ? color.color : `#${color.color}`;
                return hex.toUpperCase();
            }
        } catch (err) {
            // Continue to next format
            continue;
        }
    }

    // If original formats failed and code ends with "U", try replacing "U" with "C"
    if (trimmed.match(/[0-9]+U$/i)) {
        const withC = trimmed.replace(/U$/i, 'C');
        const formatsWithC = [
            withC,                                    // "665C"
            withC.replace(/(\d+)([A-Z])/i, '$1 $2'), // "665 C"
            withC.replace(/\s+/g, ''),                // "665C"
            `PMS ${withC}`,                          // "PMS 665C"
            `PMS ${withC.replace(/(\d+)([A-Z])/i, '$1 $2')}`, // "PMS 665 C"
        ];

        const uniqueFormatsWithC = [...new Set(formatsWithC)];

        for (const format of uniqueFormatsWithC) {
            try {
                const color = new simpleColorConverter({
                    pantone: format,
                    to: 'hex'
                });

                if (color && color.color && typeof color.color === 'string' && color.color.length === 6) {
                    const hex = color.color.startsWith('#') ? color.color : `#${color.color}`;
                    return hex.toUpperCase();
                }
            } catch (err) {
                continue;
            }
        }
    }

    return null;
}

/**
 * Check if color name matches a CSS color
 * Handles various separators: hyphens, slashes, spaces
 * e.g., "white-smoke" -> "whitesmoke", "black/lime" -> "black-lime" -> matches "black-lime"
 */
function getCssColor(colorName) {
    if (!colorName || typeof colorName !== 'string') return null;

    const normalized = colorName.toLowerCase().trim();

    // Try exact match first
    if (cssColors[normalized]) {
        return cssColors[normalized];
    }

    // Normalize separators: convert slashes and spaces to hyphens
    // e.g., "black/lime" -> "black-lime", "black lime" -> "black-lime"
    const normalizedSeparators = normalized.replace(/[\/\s]+/g, '-');
    if (normalizedSeparators !== normalized && cssColors[normalizedSeparators]) {
        return cssColors[normalizedSeparators];
    }

    // Try with all separators removed (e.g., "white-smoke" -> "whitesmoke")
    const withoutSeparators = normalized.replace(/[-\/\s]+/g, '');
    if (withoutSeparators !== normalized && cssColors[withoutSeparators]) {
        return cssColors[withoutSeparators];
    }

    return null;
}

/**
 * Get color value from variant (color_description -> color_group -> pms_color)
 */
function getColorFromVariant(variant) {
    return variant.color_description || variant.color_group || variant.pms_color || null;
}

/**
 * Convert color name to CSS variable name
 */
function toCssVarName(colorName) {
    return colorName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/^([0-9])/, 'mo-$1'); // Handle leading numbers
}

/**
 * Main function
 */
function generateColorVariables() {
    const productsPath = path.join(__dirname, 'data', 'products.json');
    const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));

    // Collect unique colors with their source information
    const colorMap = new Map(); // colorName -> { pmsColor, hex, cssColor }

    products.forEach(product => {
        if (!product.variants || !Array.isArray(product.variants)) return;

        product.variants.forEach(variant => {
            const colorName = getColorFromVariant(variant);
            if (!colorName) return;

            const normalizedName = colorName.trim();

            // Skip if already processed
            if (colorMap.has(normalizedName)) return;

            // Get PMS color for conversion attempt
            const pmsColor = variant.pms_color || null;

            // Try PMS to hex conversion (1st priority)
            let hex = null;
            if (pmsColor) {
                hex = pmsToHex(pmsColor);
            }

            // If PMS conversion failed, try predefined PMS colors lookup (2nd priority)
            let predefinedPmsHex = null;
            if (!hex && pmsColor) {
                predefinedPmsHex = getPredefinedPmsColor(pmsColor);
            }

            // If predefined PMS also failed (or no PMS color), try CSS standard colors (3rd priority)
            let cssColor = null;
            if (!hex && !predefinedPmsHex) {
                cssColor = getCssColor(colorName);
            }

            colorMap.set(normalizedName, {
                pmsColor: pmsColor,
                hex: hex,
                cssColor: cssColor,
                predefinedPmsHex: predefinedPmsHex
            });
        });
    });

    // Generate CSS output
    const cssLines = [':root {'];

    // Statistics tracking
    let foundByPms = 0;
    let notFoundByPms = 0;
    let foundByCss = 0;
    let foundByPredefinedPms = 0;
    let noValue = 0;

    // Sort colors alphabetically
    const sortedColors = Array.from(colorMap.entries()).sort((a, b) =>
        a[0].toLowerCase().localeCompare(b[0].toLowerCase())
    );

    sortedColors.forEach(([colorName, colorData]) => {
        const varName = `--mo-${toCssVarName(colorName)}`;
        let value = '';
        let comment = '';

        const pmsInfo = colorData.pmsColor ? ` pms ${colorData.pmsColor}` : '';

        if (colorData.hex) {
            // 1st priority: PMS library conversion
            value = colorData.hex;
            comment = `/* found by${pmsInfo} */`;
            foundByPms++;
        } else if (colorData.predefinedPmsHex) {
            // 2nd priority: Predefined PMS list
            value = colorData.predefinedPmsHex;
            comment = `/* not found by${pmsInfo} but found in predefined list */`;
            foundByPredefinedPms++;
            if (colorData.pmsColor) {
                notFoundByPms++;
            }
        } else if (colorData.cssColor) {
            // 3rd priority: CSS standard colors
            value = colorData.cssColor;
            comment = `/* not found by${pmsInfo} but available in css */`;
            foundByCss++;
            if (colorData.pmsColor) {
                notFoundByPms++;
            }
        } else {
            // 4th priority: Empty value
            value = '';
            comment = `/* not found by${pmsInfo} as well not available in css */`;
            noValue++;
            if (colorData.pmsColor) {
                notFoundByPms++;
            }
        }

        cssLines.push(`  ${varName}: ${value}${INCLUDE_COMMENTS ? `; ${comment}` : ';'}`);
    });

    cssLines.push('}');

    // Output to console
    console.log(cssLines.join('\n'));

    // Write to file
    const outputPath = path.join(__dirname, 'colors.css');
    fs.writeFileSync(outputPath, cssLines.join('\n'), 'utf8');

    // Calculate additional stats
    const totalWithPms = foundByPms + notFoundByPms;
    const totalWithoutPms = colorMap.size - totalWithPms;

    // Print summary
    console.log(`\n✅ Color variables written to ${outputPath}`);
    console.log(`\n📊 Summary:`);
    console.log(`   Total unique colors: ${colorMap.size}`);
    console.log(`   Colors with PMS values: ${totalWithPms}`);
    console.log(`     ├─ Found by PMS (converted): ${foundByPms}`);
    console.log(`     └─ Not found by PMS (conversion failed): ${notFoundByPms}`);
    console.log(`   Colors without PMS values: ${totalWithoutPms}`);
    console.log(`   Found by CSS fallback: ${foundByCss}`);
    console.log(`   Found by predefined PMS list: ${foundByPredefinedPms}`);
    console.log(`   No value (empty): ${noValue}`);
}

// Run the script
try {
    generateColorVariables();
} catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
}

