const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
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

// 뱃지 목록 조회
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { type, limit = 50, offset = 0 } = req.query;

    let whereConditions = ['uid = ?'];
    let queryParams = [req.user.uid];

    if (type && ['CERT', 'LANGUAGE', 'TIME', 'STREAK', 'LEVEL'].includes(type)) {
      whereConditions.push('type = ?');
      queryParams.push(type);
    }

    queryParams.push(parseInt(limit), parseInt(offset));

    const [badges] = await pool.execute(
      `SELECT 
         badge_id, type, name, description, score, acquired_at, gained_exp, created_at
       FROM badge 
       WHERE ${whereConditions.join(' AND ')}
       ORDER BY acquired_at DESC
       LIMIT ? OFFSET ?`,
      queryParams
    );

    // 전체 개수 조회
    const countParams = queryParams.slice(0, -2);
    const [totalCount] = await pool.execute(
      `SELECT COUNT(*) as total FROM badge WHERE ${whereConditions.join(' AND ')}`,
      countParams
    );

    res.json({
      success: true,
      badges,
      pagination: {
        total: totalCount[0].total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        has_more: totalCount[0].total > parseInt(offset) + parseInt(limit)
      }
    });

  } catch (error) {
    console.error('뱃지 목록 조회 오류:', error);
    res.status(500).json({
      success: false,
      error: '뱃지 목록을 조회할 수 없습니다.'
    });
  }
});

// 뱃지 추가
router.post('/', authenticateToken, [
  body('type').isIn(['CERT', 'LANGUAGE', 'TIME', 'STREAK', 'LEVEL']).withMessage('유효한 뱃지 타입을 선택하세요'),
  body('name').isLength({ min: 1, max: 100 }).withMessage('뱃지명은 1-100자 사이여야 합니다'),
  body('description').optional().isLength({ max: 500 }).withMessage('설명은 500자 이하여야 합니다'),
  body('score').optional().isLength({ max: 50 }).withMessage('점수는 50자 이하여야 합니다'),
  body('gained_exp').optional().isInt({ min: 0 }).withMessage('경험치는 0 이상이어야 합니다')
], async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: '입력 데이터가 올바르지 않습니다.',
        details: errors.array()
      });
    }

    const { type, name, description, score, gained_exp = 0 } = req.body;

    // 뱃지 추가
    const [result] = await connection.execute(
      `INSERT INTO badge (uid, type, name, description, score, acquired_at, gained_exp) 
       VALUES (?, ?, ?, ?, ?, CURDATE(), ?)`,
      [req.user.uid, type, name, description || null, score || null, gained_exp]
    );

    // 경험치 추가
    if (gained_exp > 0) {
      await connection.execute(
        'UPDATE user SET exp = exp + ?, updated_at = NOW() WHERE uid = ?',
        [gained_exp, req.user.uid]
      );

      // 레벨업 확인
      const [userInfo] = await connection.execute(
        'SELECT level, exp FROM user WHERE uid = ?',
        [req.user.uid]
      );

      const newLevel = Math.floor(userInfo[0].exp / 100) + 1;
      if (newLevel > userInfo[0].level) {
        await connection.execute(
          'UPDATE user SET level = ? WHERE uid = ?',
          [newLevel, req.user.uid]
        );
      }
    }

    await connection.commit();

    // 추가된 뱃지 정보 조회
    const [newBadge] = await connection.execute(
      'SELECT * FROM badge WHERE badge_id = ?',
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      badge: newBadge[0],
      gained_exp,
      message: `새로운 뱃지 '${name}'을(를) 획득했습니다!`
    });

  } catch (error) {
    await connection.rollback();
    console.error('뱃지 추가 오류:', error);
    res.status(500).json({
      success: false,
      error: '뱃지 추가에 실패했습니다.'
    });
  } finally {
    connection.release();
  }
});

// 특정 뱃지 조회
router.get('/:badge_id', authenticateToken, async (req, res) => {
  try {
    const [badge] = await pool.execute(
      'SELECT * FROM badge WHERE badge_id = ? AND uid = ?',
      [req.params.badge_id, req.user.uid]
    );

    if (badge.length === 0) {
      return res.status(404).json({
        success: false,
        error: '뱃지를 찾을 수 없습니다.'
      });
    }

    res.json({
      success: true,
      badge: badge[0]
    });

  } catch (error) {
    console.error('뱃지 상세 조회 오류:', error);
    res.status(500).json({
      success: false,
      error: '뱃지를 조회할 수 없습니다.'
    });
  }
});

// 뱃지 수정
router.put('/:badge_id', authenticateToken, [
  body('name').optional().isLength({ min: 1, max: 100 }).withMessage('뱃지명은 1-100자 사이여야 합니다'),
  body('description').optional().isLength({ max: 500 }).withMessage('설명은 500자 이하여야 합니다'),
  body('score').optional().isLength({ max: 50 }).withMessage('점수는 50자 이하여야 합니다')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: '입력 데이터가 올바르지 않습니다.',
        details: errors.array()
      });
    }

    const { name, description, score } = req.body;
    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }

    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description);
    }

    if (score !== undefined) {
      updates.push('score = ?');
      values.push(score);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: '수정할 정보가 없습니다.'
      });
    }

    values.push(req.params.badge_id, req.user.uid);

    const [result] = await pool.execute(
      `UPDATE badge SET ${updates.join(', ')} WHERE badge_id = ? AND uid = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: '뱃지를 찾을 수 없습니다.'
      });
    }

    // 수정된 뱃지 조회
    const [updatedBadge] = await pool.execute(
      'SELECT * FROM badge WHERE badge_id = ? AND uid = ?',
      [req.params.badge_id, req.user.uid]
    );

    res.json({
      success: true,
      badge: updatedBadge[0],
      message: '뱃지가 수정되었습니다.'
    });

  } catch (error) {
    console.error('뱃지 수정 오류:', error);
    res.status(500).json({
      success: false,
      error: '뱃지 수정에 실패했습니다.'
    });
  }
});

// 뱃지 삭제
router.delete('/:badge_id', authenticateToken, async (req, res) => {
  try {
    const [result] = await pool.execute(
      'DELETE FROM badge WHERE badge_id = ? AND uid = ?',
      [req.params.badge_id, req.user.uid]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: '뱃지를 찾을 수 없습니다.'
      });
    }

    res.json({
      success: true,
      message: '뱃지가 삭제되었습니다.'
    });

  } catch (error) {
    console.error('뱃지 삭제 오류:', error);
    res.status(500).json({
      success: false,
      error: '뱃지 삭제에 실패했습니다.'
    });
  }
});

// 뱃지 통계
router.get('/stats/summary', authenticateToken, async (req, res) => {
  try {
    const [stats] = await pool.execute(
      `SELECT 
         type,
         COUNT(*) as badge_count,
         COALESCE(SUM(gained_exp), 0) as total_exp_from_badges,
         MIN(acquired_at) as first_badge,
         MAX(acquired_at) as latest_badge
       FROM badge 
       WHERE uid = ?
       GROUP BY type
       ORDER BY badge_count DESC`,
      [req.user.uid]
    );

    // 전체 요약
    const [totalStats] = await pool.execute(
      `SELECT 
         COUNT(*) as total_badges,
         COALESCE(SUM(gained_exp), 0) as total_exp_from_all_badges,
         MIN(acquired_at) as first_badge_date,
         MAX(acquired_at) as latest_badge_date
       FROM badge 
       WHERE uid = ?`,
      [req.user.uid]
    );

    res.json({
      success: true,
      badge_stats: {
        total: totalStats[0],
        by_type: stats
      }
    });

  } catch (error) {
    console.error('뱃지 통계 조회 오류:', error);
    res.status(500).json({
      success: false,
      error: '뱃지 통계를 조회할 수 없습니다.'
    });
  }
});

// 자동 뱃지 체크 (내부 함수)
async function checkAndAwardBadges(userId) {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    // 각종 뱃지 조건 확인 및 자동 수여
    
    // 1. 연속 학습 뱃지
    const [streakData] = await connection.execute(
      `SELECT COUNT(DISTINCT DATE(created_at)) as study_days
       FROM work_log 
       WHERE uid = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
      [userId]
    );
    
    if (streakData[0].study_days >= 30) {
      // 30일 연속 학습 뱃지 확인
      const [existingBadge] = await connection.execute(
        'SELECT badge_id FROM badge WHERE uid = ? AND type = "STREAK" AND name = "30일 연속 학습"',
        [userId]
      );
      
      if (existingBadge.length === 0) {
        await connection.execute(
          `INSERT INTO badge (uid, type, name, description, acquired_at, gained_exp) 
           VALUES (?, "STREAK", "30일 연속 학습", "30일 연속으로 학습을 완료했습니다", CURDATE(), 100)`,
          [userId]
        );
        
        await connection.execute(
          'UPDATE user SET exp = exp + 100 WHERE uid = ?',
          [userId]
        );
      }
    }
    
    // 2. 시간 누적 뱃지
    const [totalTimeData] = await connection.execute(
      'SELECT COALESCE(SUM(duration), 0) as total_time FROM work_log WHERE uid = ?',
      [userId]
    );
    
    const totalHours = Math.floor(totalTimeData[0].total_time / 3600);
    
    if (totalHours >= 100) {
      const [existingBadge] = await connection.execute(
        'SELECT badge_id FROM badge WHERE uid = ? AND type = "TIME" AND name = "100시간 달성"',
        [userId]
      );
      
      if (existingBadge.length === 0) {
        await connection.execute(
          `INSERT INTO badge (uid, type, name, description, acquired_at, gained_exp) 
           VALUES (?, "TIME", "100시간 달성", "총 학습시간 100시간을 달성했습니다", CURDATE(), 200)`,
          [userId]
        );
        
        await connection.execute(
          'UPDATE user SET exp = exp + 200 WHERE uid = ?',
          [userId]
        );
      }
    }
    
    await connection.commit();
    
  } catch (error) {
    await connection.rollback();
    console.error('자동 뱃지 체크 오류:', error);
  } finally {
    connection.release();
  }
}

// 자동 뱃지 체크 엔드포인트 (타이머 종료 시 호출)
router.post('/check-auto-badges', authenticateToken, async (req, res) => {
  try {
    await checkAndAwardBadges(req.user.uid);
    
    res.json({
      success: true,
      message: '자동 뱃지 체크가 완료되었습니다.'
    });
    
  } catch (error) {
    console.error('자동 뱃지 체크 오류:', error);
    res.status(500).json({
      success: false,
      error: '자동 뱃지 체크에 실패했습니다.'
    });
  }
});

module.exports = router;