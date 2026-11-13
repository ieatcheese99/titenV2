const fs = require('fs');
const path = require('path');

function verifyHtml(htmlContent) {
  const idsInAppJs = fs.readFileSync(path.join(__dirname, '../scripts/find_ids.js'), 'utf8');
  // run find_ids logic
  const appContent = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
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
    while ((m = re.exec(appContent)) !== null) {
      allIds.add(m[1]);
    }
  }

  const missing = [];
  for (const id of allIds) {
    const regex = new RegExp(`id=["']${id}["']`);
    if (!regex.test(htmlContent)) {
      missing.push(id);
    }
  }

  console.log('Total required IDs:', allIds.size);
  console.log('Missing IDs:', missing.length);
  if (missing.length > 0) {
    console.log('List of missing IDs:', missing);
  } else {
    console.log('All 88 IDs are present and verified!');
  }
  return missing.length === 0;
}

module.exports = { verifyHtml };

