const express = require('express');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const router = express.Router();

// 토큰 검증 미들웨어
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      error: '액세스 토큰이 없습니다.'
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({
        success: false,
        error: '유효하지 않은 토큰입니다.'
      });
    }
    
    req.user = decoded;
    next();
  });
}

// 사용자 정보 조회
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const [user] = await pool.execute(
      `SELECT uid, provider, email, name, profile_url, age, level, exp, is_guest, 
              created_at, updated_at
       FROM user WHERE uid = ?`,
      [req.user.uid]
    );

    if (user.length === 0) {
      return res.status(404).json({
        success: false,
        error: '사용자를 찾을 수 없습니다.'
      });
    }

    res.json({
      success: true,
      user: user[0]
    });
    
  } catch (error) {
    console.error('사용자 정보 조회 오류:', error);
    res.status(500).json({
      success: false,
      error: '사용자 정보를 조회할 수 없습니다.'
    });
  }
});

// 사용자 정보 업데이트
router.put('/me', authenticateToken, async (req, res) => {
  try {
    const { name, age } = req.body;
    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    
    if (age !== undefined) {
      updates.push('age = ?');
      values.push(age);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: '업데이트할 정보가 없습니다.'
      });
    }

    updates.push('updated_at = NOW()');
    values.push(req.user.uid);

    await pool.execute(
      `UPDATE user SET ${updates.join(', ')} WHERE uid = ?`,
      values
    );

    // 업데이트된 사용자 정보 반환
    const [updatedUser] = await pool.execute(
      `SELECT uid, provider, email, name, profile_url, age, level, exp, is_guest, 
              created_at, updated_at
       FROM user WHERE uid = ?`,
      [req.user.uid]
    );

    res.json({
      success: true,
      user: updatedUser[0],
      message: '사용자 정보가 업데이트되었습니다.'
    });
    
  } catch (error) {
    console.error('사용자 정보 업데이트 오류:', error);
    res.status(500).json({
      success: false,
      error: '사용자 정보 업데이트에 실패했습니다.'
    });
  }
});

// 사용자 통계 조회
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    // 기본 통계
    const [basicStats] = await pool.execute(
      `SELECT 
         level, exp,
         (SELECT COUNT(*) FROM work_log WHERE uid = ? AND DATE(created_at) = CURDATE()) as today_sessions,
         (SELECT COALESCE(SUM(duration), 0) FROM work_log WHERE uid = ? AND DATE(created_at) = CURDATE()) as today_total_time,
         (SELECT COUNT(*) FROM work_log WHERE uid = ?) as total_sessions,
         (SELECT COALESCE(SUM(duration), 0) FROM work_log WHERE uid = ?) as total_study_time,
         (SELECT COUNT(*) FROM badge WHERE uid = ?) as total_badges
       FROM user WHERE uid = ?`,
      [req.user.uid, req.user.uid, req.user.uid, req.user.uid, req.user.uid, req.user.uid]
    );

    // 카테고리별 통계
    const [categoryStats] = await pool.execute(
      `SELECT 
         category,
         COUNT(*) as sessions,
         COALESCE(SUM(duration), 0) as total_time,
         AVG(duration) as avg_time
       FROM work_log 
       WHERE uid = ?
       GROUP BY category`,
      [req.user.uid]
    );

    // 최근 7일 활동
    const [weeklyStats] = await pool.execute(
      `SELECT 
         DATE(created_at) as date,
         COUNT(*) as sessions,
         COALESCE(SUM(duration), 0) as total_time
       FROM work_log 
       WHERE uid = ? AND DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
       GROUP BY DATE(created_at)
       ORDER BY DATE(created_at) DESC`,
      [req.user.uid]
    );

    res.json({
      success: true,
      stats: {
        basic: basicStats[0] || {},
        categories: categoryStats,
        weekly: weeklyStats
      }
    });
    
  } catch (error) {
    console.error('사용자 통계 조회 오류:', error);
    res.status(500).json({
      success: false,
      error: '사용자 통계를 조회할 수 없습니다.'
    });
  }
});

// 경험치 업데이트
router.post('/add-exp', authenticateToken, async (req, res) => {
  try {
    const { exp_gained, reason } = req.body;

    if (!exp_gained || exp_gained <= 0) {
      return res.status(400).json({
        success: false,
        error: '유효한 경험치 값을 입력하세요.'
      });
    }

    // 현재 사용자 정보 조회
    const [currentUser] = await pool.execute(
      'SELECT level, exp FROM user WHERE uid = ?',
      [req.user.uid]
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
    await pool.execute(
      'UPDATE user SET exp = ?, level = ?, updated_at = NOW() WHERE uid = ?',
      [newExp, newLevel, req.user.uid]
    );

    res.json({
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
    
  } catch (error) {
    console.error('경험치 업데이트 오류:', error);
    res.status(500).json({
      success: false,
      error: '경험치 업데이트에 실패했습니다.'
    });
  }
});

// 랭킹 조회
router.get('/ranking', async (req, res) => {
  try {
    const { limit = 100, category } = req.query;

    let query = `
      SELECT 
        u.uid, u.name, u.profile_url, u.level, u.exp,
        COALESCE(SUM(w.duration), 0) as total_study_time,
        COALESCE(COUNT(w.work_id), 0) as total_sessions,
        COALESCE(COUNT(DISTINCT b.badge_id), 0) as total_badges,
        MAX(w.created_at) as last_activity
      FROM user u
      LEFT JOIN work_log w ON u.uid = w.uid ${category ? 'AND w.category = ?' : ''}
      LEFT JOIN badge b ON u.uid = b.uid
      WHERE u.is_guest = 0
      GROUP BY u.uid, u.name, u.profile_url, u.level, u.exp
      ORDER BY u.level DESC, u.exp DESC, total_study_time DESC
      LIMIT ?
    `;

    const params = category ? [category, parseInt(limit)] : [parseInt(limit)];
    const [rankings] = await pool.execute(query, params);

    // 순위 번호 추가
    const rankedUsers = rankings.map((user, index) => ({
      ...user,
      rank: index + 1
    }));

    res.json({
      success: true,
      rankings: rankedUsers,
      total: rankedUsers.length,
      category: category || 'all'
    });
    
  } catch (error) {
    console.error('랭킹 조회 오류:', error);
    res.status(500).json({
      success: false,
      error: '랭킹 정보를 조회할 수 없습니다.'
    });
  }
});

module.exports = router;