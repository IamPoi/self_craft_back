const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어
app.use(cors());
app.use(express.json());

// API 라우터 import
const indexHandler = require('./api/index');

// 모든 요청을 index.js로 라우팅
app.use('*', async (req, res) => {
  req.url = req.originalUrl;
  await indexHandler(req, res);
});

app.listen(PORT, () => {
  console.log(`🚀 Selfcraft API Server running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`📋 API docs: http://localhost:${PORT}/api`);
});

module.exports = app;