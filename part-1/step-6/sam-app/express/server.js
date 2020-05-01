const express = require('express');
const router = require('./router');

const port = 3000;
const app = express();
app.use('/express', router);
app.listen(port, () => console.log(`Example app listening at http://localhost:${port}`));
