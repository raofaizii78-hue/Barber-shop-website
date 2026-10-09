// Start file: run with  npm start  (or: node node.js)
const app = require('./server.js');
const port = process.env.PORT || 3000;

app.listen(port, () => {
    console.log(`Faizii Barber Shop running: http://localhost:${port}`);
});