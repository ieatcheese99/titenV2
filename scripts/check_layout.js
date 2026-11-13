const fs = require('fs');
const { verifyHtml } = require('./verify_ids.js');

const html = fs.readFileSync('./index.html', 'utf8');
const result = verifyHtml(html);
console.log('Verification result:', result ? 'PASSED' : 'FAILED');
process.exit(result ? 0 : 1);
