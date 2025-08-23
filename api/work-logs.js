const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');

// MariaDB 연결 설정
const getConnection = async () => {
  return await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    collation: 'utf8mb4_unicode_ci'
  });
};

// 토큰 검증 함수
const verifyToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return null;
  }
};

module.exports = async (req, res) => {
  try {
    // CORS 설정
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    // 토큰 검증
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: '액세스 토큰이 필요합니다.'
      });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(403).json({
        success: false,
        error: '유효하지 않은 토큰입니다.'
      });
    }

    const { url, method } = req;

    // POST /api/work-logs/start - 타이머 시작
    if (url === '/api/work-logs/start' && method === 'POST') {
      const body = JSON.parse(req.body || '{}');
      const { category, title } = body;

      if (!category || !['STUDY', 'EXERCISE', 'LANGUAGE', 'CERTIFICATE'].includes(category)) {
        return res.status(400).json({
          success: false,
          error: '유효한 카테고리를 선택하세요. (STUDY, EXERCISE, LANGUAGE, CERTIFICATE)'
        });
      }

      const connection = await getConnection();
      
      try {
        // 진행 중인 세션이 있는지 확인
        const [activeSessions] = await connection.execute(
          'SELECT work_id FROM work_log WHERE uid = ? AND ended_at IS NULL',
          [decoded.uid]
        );

        if (activeSessions.length > 0) {
          return res.status(400).json({
            success: false,
            error: '이미 진행 중인 타이머 세션이 있습니다.'
          });
        }

        const [result] = await connection.execute(
          `INSERT INTO work_log (uid, category, title, started_at) 
           VALUES (?, ?, ?, NOW())`,
          [decoded.uid, category, title || null]
        );

        return res.status(201).json({
          success: true,
          session: {
            work_id: result.insertId,
            category,
            title: title || null,
            started_at: new Date().toISOString()
          },
          message: '타이머가 시작되었습니다.'
        });

      } finally {
        await connection.end();
      }
    }

    // POST /api/work-logs/stop/:work_id - 타이머 종료
    if (url.startsWith('/api/work-logs/stop/') && method === 'POST') {
      const work_id = url.split('/')[4];
      const body = JSON.parse(req.body || '{}');
      const { duration } = body;

      if (!duration || duration <= 0) {
        return res.status(400).json({
          success: false,
          error: '유효한 지속 시간을 입력하세요.'
        });
      }

      const connection = await getConnection();
      
      try {
        await connection.beginTransaction();

        // 세션 존재 및 소유권 확인
        const [session] = await connection.execute(
          'SELECT * FROM work_log WHERE work_id = ? AND uid = ? AND ended_at IS NULL',
          [work_id, decoded.uid]
        );

        if (session.length === 0) {
          await connection.rollback();
          return res.status(404).json({
            success: false,
            error: '진행 중인 타이머 세션을 찾을 수 없습니다.'
          });
        }

        // 자동 경험치 계산 (1분당 1 경험치)
        const autoGainedExp = Math.floor(duration / 60);

        // 세션 종료
        await connection.execute(
          `UPDATE work_log SET 
             ended_at = NOW(), 
             duration = ?, 
             gained_exp = ?
           WHERE work_id = ?`,
          [duration, autoGainedExp, work_id]
        );

        // 사용자 경험치 업데이트
        if (autoGainedExp > 0) {
          await connection.execute(
            'UPDATE user SET exp = exp + ?, updated_at = NOW() WHERE uid = ?',
            [autoGainedExp, decoded.uid]
          );

          // 레벨업 확인
          const [userInfo] = await connection.execute(
            'SELECT level, exp FROM user WHERE uid = ?',
            [decoded.uid]
          );

          const newLevel = Math.floor(userInfo[0].exp / 100) + 1;
          if (newLevel > userInfo[0].level) {
            await connection.execute(
              'UPDATE user SET level = ? WHERE uid = ?',
              [newLevel, decoded.uid]
            );
          }
        }

        await connection.commit();

        // 완료된 세션 정보 조회
        const [completedSession] = await connection.execute(
          'SELECT * FROM work_log WHERE work_id = ?',
          [work_id]
        );

        return res.json({
          success: true,
          session: completedSession[0],
          gained_exp: autoGainedExp,
          message: `타이머가 종료되었습니다. ${autoGainedExp} 경험치를 획득했습니다.`
        });

      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        await connection.end();
      }
    }

    // GET /api/work-logs/active - 진행 중인 세션 조회
    if (url === '/api/work-logs/active' && method === 'GET') {
      const connection = await getConnection();
      
      try {
        const [activeSessions] = await connection.execute(
          'SELECT * FROM work_log WHERE uid = ? AND ended_at IS NULL ORDER BY started_at DESC',
          [decoded.uid]
        );

        return res.json({
          success: true,
          active_sessions: activeSessions
        });

      } finally {
        await connection.end();
      }
    }

    // GET /api/work-logs - 작업 로그 조회
    if (url === '/api/work-logs' && method === 'GET') {
      const connection = await getConnection();
      
      try {
        const [workLogs] = await connection.execute(
          `SELECT 
             work_id, category, title, started_at, ended_at, duration, gained_exp, created_at
           FROM work_log 
           WHERE uid = ? AND ended_at IS NOT NULL
           ORDER BY created_at DESC
           LIMIT 50`,
          [decoded.uid]
        );

        return res.json({
          success: true,
          work_logs: workLogs,
          total: workLogs.length
        });

      } finally {
        await connection.end();
      }
    }

    // GET /api/work-logs/stats/category - 카테고리별 통계
    if (url === '/api/work-logs/stats/category' && method === 'GET') {
      const connection = await getConnection();
      
      try {
        const [stats] = await connection.execute(
          `SELECT 
             category,
             COUNT(*) as session_count,
             COALESCE(SUM(duration), 0) as total_duration,
             COALESCE(AVG(duration), 0) as avg_duration,
             COALESCE(SUM(gained_exp), 0) as total_exp,
             MIN(created_at) as first_session,
             MAX(created_at) as last_session
           FROM work_log 
           WHERE uid = ? AND ended_at IS NOT NULL
           GROUP BY category
           ORDER BY total_duration DESC`,
          [decoded.uid]
        );

        return res.json({
          success: true,
          category_stats: stats
        });

      } finally {
        await connection.end();
      }
    }

    // 지원하지 않는 경로
    return res.status(404).json({
      success: false,
      error: 'Route not found',
      available_routes: [
        'POST /api/work-logs/start',
        'POST /api/work-logs/stop/:work_id',
        'GET /api/work-logs/active',
        'GET /api/work-logs',
        'GET /api/work-logs/stats/category'
      ]
    });

  } catch (error) {
    console.error('❌ Work Logs API Error:', error);
    return res.status(500).json({
      success: false,
      error: '서버 오류가 발생했습니다.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};