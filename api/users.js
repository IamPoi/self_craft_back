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
    charset: 'utf8mb4'
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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
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

    // GET /api/users/me - 사용자 정보 조회
    if (url === '/api/users/me' && method === 'GET') {
      const connection = await getConnection();
      
      try {
        const [user] = await connection.execute(
          `SELECT uid, provider, email, name, profile_url, age, level, exp, is_guest, 
                  created_at, updated_at
           FROM user WHERE uid = ?`,
          [decoded.uid]
        );

        if (user.length === 0) {
          return res.status(404).json({
            success: false,
            error: '사용자를 찾을 수 없습니다.'
          });
        }

        return res.json({
          success: true,
          user: user[0]
        });

      } finally {
        await connection.end();
      }
    }

    // GET /api/users/stats - 사용자 통계 조회
    if (url === '/api/users/stats' && method === 'GET') {
      const connection = await getConnection();
      
      try {
        // 기본 통계
        const [basicStats] = await connection.execute(
          `SELECT 
             level, exp,
             (SELECT COUNT(*) FROM work_log WHERE uid = ? AND DATE(created_at) = CURDATE()) as today_sessions,
             (SELECT COALESCE(SUM(duration), 0) FROM work_log WHERE uid = ? AND DATE(created_at) = CURDATE()) as today_total_time,
             (SELECT COUNT(*) FROM work_log WHERE uid = ?) as total_sessions,
             (SELECT COALESCE(SUM(duration), 0) FROM work_log WHERE uid = ?) as total_study_time,
             (SELECT COUNT(*) FROM badge WHERE uid = ?) as total_badges
           FROM user WHERE uid = ?`,
          [decoded.uid, decoded.uid, decoded.uid, decoded.uid, decoded.uid, decoded.uid]
        );

        // 카테고리별 통계
        const [categoryStats] = await connection.execute(
          `SELECT 
             category,
             COUNT(*) as sessions,
             COALESCE(SUM(duration), 0) as total_time,
             AVG(duration) as avg_time
           FROM work_log 
           WHERE uid = ?
           GROUP BY category`,
          [decoded.uid]
        );

        // 최근 7일 활동
        const [weeklyStats] = await connection.execute(
          `SELECT 
             DATE(created_at) as date,
             COUNT(*) as sessions,
             COALESCE(SUM(duration), 0) as total_time
           FROM work_log 
           WHERE uid = ? AND DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
           GROUP BY DATE(created_at)
           ORDER BY DATE(created_at) DESC`,
          [decoded.uid]
        );

        return res.json({
          success: true,
          stats: {
            basic: basicStats[0] || {},
            categories: categoryStats,
            weekly: weeklyStats
          }
        });

      } finally {
        await connection.end();
      }
    }

    // POST /api/users/add-exp - 경험치 추가
    if (url === '/api/users/add-exp' && method === 'POST') {
      const body = JSON.parse(req.body || '{}');
      const { exp_gained, reason } = body;

      if (!exp_gained || exp_gained <= 0) {
        return res.status(400).json({
          success: false,
          error: '유효한 경험치 값을 입력하세요.'
        });
      }

      const connection = await getConnection();
      
      try {
        // 현재 사용자 정보 조회
        const [currentUser] = await connection.execute(
          'SELECT level, exp FROM user WHERE uid = ?',
          [decoded.uid]
        );

        if (currentUser.length === 0) {
          return res.status(404).json({
            success: false,
            error: '사용자를 찾을 수 없습니다.'
          });
        }

        const oldExp = currentUser[0].exp;
        const oldLevel = currentUser[0].level;
        const newExp = oldExp + exp_gained;
        
        // 레벨 업 계산 (100 경험치당 1레벨)
        const newLevel = Math.floor(newExp / 100) + 1;
        const leveledUp = newLevel > oldLevel;

        // 경험치 및 레벨 업데이트
        await connection.execute(
          'UPDATE user SET exp = ?, level = ?, updated_at = NOW() WHERE uid = ?',
          [newExp, newLevel, decoded.uid]
        );

        return res.json({
          success: true,
          exp_gained,
          old_exp: oldExp,
          new_exp: newExp,
          old_level: oldLevel,
          new_level: newLevel,
          leveled_up: leveledUp,
          reason: reason || '활동 완료',
          message: leveledUp ? `축하합니다! 레벨 ${newLevel}로 승급했습니다!` : `${exp_gained} 경험치를 획득했습니다.`
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
        'GET /api/users/me',
        'GET /api/users/stats', 
        'POST /api/users/add-exp'
      ]
    });

  } catch (error) {
    console.error('❌ Users API Error:', error);
    return res.status(500).json({
      success: false,
      error: '서버 오류가 발생했습니다.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};