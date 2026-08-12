/**
 * Draws the app icons. There is no image library in the toolchain, so
 * the shapes are rasterised by hand and written out as PNG.
 *
 *   node tools/make-icons.js
 */

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var SIZES = [
    { size: 180, file: 'app/icon-180.png' },
    { size: 192, file: 'app/icon-192.png' },
    { size: 512, file: 'app/icon-512.png' }
];

var SAMPLES = 3;

function mix(a, b, t) {
    return [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t
    ];
}

/**
 * Rotate a point about the centre of the canvas.
 */
function rotate(x, y, degrees) {
    var radians = degrees * Math.PI / 180;
    var cos = Math.cos(radians);
    var sin = Math.sin(radians);

    return [x * cos + y * sin, -x * sin + y * cos];
}

function roundedRect(x, y, halfWidth, halfHeight, radius) {
    var dx = Math.abs(x) - (halfWidth - radius);
    var dy = Math.abs(y) - (halfHeight - radius);

    if (dx <= 0 || dy <= 0) {
        return Math.abs(x) <= halfWidth && Math.abs(y) <= halfHeight;
    }

    return dx * dx + dy * dy <= radius * radius;
}

function inCircle(x, y, cx, cy, r) {
    var dx = x - cx;
    var dy = y - cy;

    return dx * dx + dy * dy <= r * r;
}

function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
    function side(x1, y1, x2, y2) {
        return (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
    }

    var d1 = side(ax, ay, bx, by);
    var d2 = side(bx, by, cx, cy);
    var d3 = side(cx, cy, ax, ay);
    var negative = (d1 < 0) || (d2 < 0) || (d3 < 0);
    var positive = (d1 > 0) || (d2 > 0) || (d3 > 0);

    return !(negative && positive);
}

/**
 * A spade in unit coordinates, centred on the origin.
 */
function inSpade(x, y) {
    if (inCircle(x, y, -0.24, 0.04, 0.28)) { return true; }
    if (inCircle(x, y, 0.24, 0.04, 0.28)) { return true; }
    if (inTriangle(x, y, 0, -0.56, -0.5, 0.12, 0.5, 0.12)) { return true; }

    // Stem
    if (y > 0.1 && y < 0.54) {
        var spread = 0.045 + (y - 0.1) * 0.52;

        if (Math.abs(x) < spread) { return true; }
    }

    return false;
}

/**
 * The colour of one sample point, in canvas coordinates running from
 * -1 to 1 on both axes.
 */
function sample(x, y) {
    // Felt background, brighter at the top
    var t = (y + 1) / 2;
    var colour = mix([31, 106, 72], [5, 19, 13], Math.pow(t, 0.85));

    // Back card, tipped to the left
    var back = rotate(x + 0.16, y + 0.02, -16);

    if (roundedRect(back[0], back[1], 0.4, 0.56, 0.09)) {
        colour = [214, 224, 219];
    }

    // Front card
    var front = rotate(x - 0.08, y, 7);

    if (roundedRect(front[0], front[1], 0.42, 0.58, 0.09)) {
        colour = [252, 253, 252];

        if (inSpade(front[0] / 0.62, (front[1] + 0.02) / 0.62)) {
            colour = [18, 26, 22];
        }
    }

    return colour;
}

function render(size) {
    var pixels = Buffer.alloc(size * size * 4);

    for (var py = 0; py < size; py+=1) {
        for (var px = 0; px < size; px+=1) {
            var r = 0, g = 0, b = 0;

            for (var sy = 0; sy < SAMPLES; sy+=1) {
                for (var sx = 0; sx < SAMPLES; sx+=1) {
                    var x = ((px + (sx + 0.5) / SAMPLES) / size) * 2 - 1;
                    var y = ((py + (sy + 0.5) / SAMPLES) / size) * 2 - 1;
                    var colour = sample(x, y);

                    r += colour[0];
                    g += colour[1];
                    b += colour[2];
                }
            }

            var count = SAMPLES * SAMPLES;
            var offset = (py * size + px) * 4;

            pixels[offset] = Math.round(r / count);
            pixels[offset + 1] = Math.round(g / count);
            pixels[offset + 2] = Math.round(b / count);
            pixels[offset + 3] = 255;
        }
    }

    return pixels;
}

/* ------------------------------------------------------------------ PNG */

var CRC_TABLE = (function() {
    var table = [];

    for (var n = 0; n < 256; n+=1) {
        var c = n;

        for (var k = 0; k < 8; k+=1) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }

        table[n] = c >>> 0;
    }

    return table;
}());

function crc32(buffer) {
    var crc = 0xffffffff;

    for (var i = 0; i < buffer.length; i+=1) {
        crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
    }

    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    var length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);

    var body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    var crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);

    return Buffer.concat([length, body, crc]);
}

function png(size, pixels) {
    var header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header[8] = 8;    // bit depth
    header[9] = 6;    // truecolour with alpha
    header[10] = 0;   // deflate
    header[11] = 0;   // adaptive filtering
    header[12] = 0;   // no interlace

    var raw = Buffer.alloc(size * (size * 4 + 1));

    for (var y = 0; y < size; y+=1) {
        raw[y * (size * 4 + 1)] = 0;
        pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
    }

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

var root = path.join(__dirname, '..');

SIZES.forEach(function(target) {
    var file = path.join(root, target.file);

    fs.writeFileSync(file, png(target.size, render(target.size)));
    console.log('wrote ' + target.file + ' (' + target.size + 'px)');
});
