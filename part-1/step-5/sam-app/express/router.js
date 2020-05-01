const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const router = express.Router();

router.use(cors());
router.use(bodyParser.json());
router.use(bodyParser.urlencoded({ extended: true }));

router.get('/', (req, res) => res.send('Hello World!'));

router.post('/test', (req, res) => {
  console.log('Query: ', JSON.stringify(req.query || {}, null, 2));
  console.log('Body: ', JSON.stringify(req.body || {}, null, 2));
  res.send('Ok');
});

module.exports = router;
