const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');

const regexes = [
  /getEl\(['"]([^'"]+)['"]/g,
  /setText\(['"]([^'"]+)['"]/g,
  /setHtml\(['"]([^'"]+)['"]/g,
  /document\.getElementById\(['"]([^'"]+)['"]/g,
  /querySelector\(['"]#([a-zA-Z0-9_-]+)['"]/g
];

const allIds = new Set();
for (const re of regexes) {
  let m;
  while ((m = re.exec(content)) !== null) {
    allIds.add(m[1]);
  }
}

console.log('Total IDs found in app.js:', allIds.size);
console.log(Array.from(allIds).sort().join('\n'));
