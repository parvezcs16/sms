const express = require('express');
const { getDb } = require('../db/connection');
const asyncHandler = require('../utils/asyncHandler');
const { HttpError } = require('../middleware/errors');
const licenseService = require('../services/license');

const router = express.Router();

router.get('/status', asyncHandler(async (req, res) => {
  res.json(licenseService.getLocalStatus(getDb()));
}));

router.post('/activate', asyncHandler(async (req, res) => {
  if (!req.body || !req.body.key) throw new HttpError(400, 'License key is required');
  res.json(licenseService.activate(getDb(), req.body.key));
}));

module.exports = router;
