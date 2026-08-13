/**
 * Assembles www/, the folder the iOS shell ships inside its bundle.
 *
 *   node tools/build-app.js
 *
 * The repository root is the web site, so it holds things the app has
 * no use for: the test suite, the icon rasteriser, the README's
 * screenshots, and the service worker, which is dead weight once the
 * files are already on the device.
 */

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var OUT = path.join(ROOT, 'www');

// Everything the running app actually loads
var INCLUDE = ['index.html', 'manifest.webmanifest', 'src', 'app'];

// Folders inside those that are for the repository, not the app
var SKIP = ['screens'];

function copy(from, to) {
    var stat = fs.statSync(from);

    if (stat.isDirectory()) {
        if (SKIP.indexOf(path.basename(from)) !== -1) {
            return 0;
        }

        fs.mkdirSync(to, { recursive: true });

        return fs.readdirSync(from).reduce(function(count, entry) {
            return count + copy(path.join(from, entry), path.join(to, entry));
        }, 0);
    }

    fs.copyFileSync(from, to);

    return 1;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

var files = INCLUDE.reduce(function(count, entry) {
    var source = path.join(ROOT, entry);

    if (!fs.existsSync(source)) {
        throw new Error('missing ' + entry);
    }

    return count + copy(source, path.join(OUT, entry));
}, 0);

console.log('www/ built from ' + files + ' files');
