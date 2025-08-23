const mysql = require('mysql2/promise');

// MariaDB 연결 테스트
const testConnection = async () => {
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      charset: 'utf8mb4',
      collation: 'utf8mb4_unicode_ci'
    });
    
    await connection.execute('SELECT 1');
    await connection.end();
    return true;
  } catch (error) {
    console.error('DB Connection Error:', error);
    return false;
  }
};

// 메인 라우터
module.exports = async (req, res) => {
  try {
    // CORS 헤더 설정
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    const { url, method } = req;

    // API 라우팅 - Vercel에서는 각 API별로 별도 파일 처리
    if (url.startsWith('/api/auth/')) {
      const authHandler = require('./auth');
      return authHandler(req, res);
    }

    if (url.startsWith('/api/users/')) {
      const usersHandler = require('./users');
      return usersHandler(req, res);
    }

    if (url.startsWith('/api/work-logs/')) {
      const workLogsHandler = require('./work-logs');
      return workLogsHandler(req, res);
    }

    // 기본 라우트들
    if (url === '/' && method === 'GET') {
      return res.status(200).json({
        message: '🚀 Selfcraft API Server',
        version: '2.0.0',
        status: 'running',
        timestamp: new Date().toISOString(),
        platform: 'Vercel Serverless',
        database: 'MariaDB Connected'
      });
    }

    if (url === '/health' && method === 'GET') {
      const dbConnected = await testConnection();
      
      return res.status(200).json({
        status: 'healthy',
        platform: 'Vercel',
        timestamp: new Date().toISOString(),
        database: dbConnected ? 'Connected' : 'Disconnected',
        env_check: {
          DB_HOST: !!process.env.DB_HOST,
          DB_PORT: !!process.env.DB_PORT,
          DB_USER: !!process.env.DB_USER,
          DB_PASSWORD: !!process.env.DB_PASSWORD,
          DB_NAME: !!process.env.DB_NAME,
          JWT_SECRET: !!process.env.JWT_SECRET
        }
      });
    }

    if (url === '/api' && method === 'GET') {
      return res.status(200).json({
        message: '✅ Selfcraft API is running',
        version: '2.0.0',
        endpoints: {
          auth: [
            'POST /api/auth/guest',
            'POST /api/auth/google',
            'POST /api/auth/migrate-guest'
          ],
          users: [
            'GET /api/users/me',
            'GET /api/users/stats',
            'POST /api/users/add-exp'
          ],
          workLogs: [
            'POST /api/work-logs/start',
            'POST /api/work-logs/stop/:id',
            'GET /api/work-logs/active',
            'GET /api/work-logs',
            'GET /api/work-logs/stats/category'
          ]
        }
      });
    }

    // 404 처리
    return res.status(404).json({
      success: false,
      error: 'Route not found',
      path: url,
      method: method,
      available_routes: [
        '/',
        '/health',
        '/api',
        '/api/auth/*',
        '/api/users/*',
        '/api/work-logs/*'
      ]
    });

  } catch (error) {
    console.error('❌ Main Router Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};