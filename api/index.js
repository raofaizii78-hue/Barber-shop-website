// Vercel's explicit serverless entry point. Keeping this separate from the
// local `node server.js` entry makes POST requests reliable in production.
module.exports = require('../server');
