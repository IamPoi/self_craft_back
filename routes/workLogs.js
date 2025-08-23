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

// 타이머 세션 시작
router.post('/start', authenticateToken, [
  body('category').isIn(['STUDY', 'EXERCISE', 'LANGUAGE', 'CERTIFICATE']).withMessage('유효한 카테고리를 선택하세요'),
  body('title').optional().isLength({ max: 100 }).withMessage('제목은 100자 이하여야 합니다')
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

    const { category, title } = req.body;

    // 진행 중인 세션이 있는지 확인
    const [activeSessions] = await pool.execute(
      'SELECT work_id FROM work_log WHERE uid = ? AND ended_at IS NULL',
      [req.user.uid]
    );

    if (activeSessions.length > 0) {
      return res.status(400).json({
        success: false,
        error: '이미 진행 중인 타이머 세션이 있습니다.'
      });
    }

    const [result] = await pool.execute(
      `INSERT INTO work_log (uid, category, title, started_at) 
       VALUES (?, ?, ?, NOW())`,
      [req.user.uid, category, title || null]
    );

    res.status(201).json({
      success: true,
      session: {
        work_id: result.insertId,
        category,
        title: title || null,
        started_at: new Date().toISOString()
      },
      message: '타이머가 시작되었습니다.'
    });

  } catch (error) {
    console.error('타이머 시작 오류:', error);
    res.status(500).json({
      success: false,
      error: '타이머 시작에 실패했습니다.'
    });
  }
});

// 타이머 세션 종료
router.post('/stop/:work_id', authenticateToken, [
  body('duration').isInt({ min: 1 }).withMessage('지속 시간은 1초 이상이어야 합니다'),
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

    const work_id = req.params.work_id;
    const { duration, gained_exp = 0 } = req.body;

    // 세션 존재 및 소유권 확인
    const [session] = await connection.execute(
      'SELECT * FROM work_log WHERE work_id = ? AND uid = ? AND ended_at IS NULL',
      [work_id, req.user.uid]
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
    const totalGainedExp = gained_exp + autoGainedExp;

    // 세션 종료
    await connection.execute(
      `UPDATE work_log SET 
         ended_at = NOW(), 
         duration = ?, 
         gained_exp = ?
       WHERE work_id = ?`,
      [duration, totalGainedExp, work_id]
    );

    // 사용자 경험치 업데이트
    if (totalGainedExp > 0) {
      await connection.execute(
        'UPDATE user SET exp = exp + ?, updated_at = NOW() WHERE uid = ?',
        [totalGainedExp, req.user.uid]
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

    // 완료된 세션 정보 조회
    const [completedSession] = await connection.execute(
      'SELECT * FROM work_log WHERE work_id = ?',
      [work_id]
    );

    res.json({
      success: true,
      session: completedSession[0],
      gained_exp: totalGainedExp,
      message: `타이머가 종료되었습니다. ${totalGainedExp} 경험치를 획득했습니다.`
    });

  } catch (error) {
    await connection.rollback();
    console.error('타이머 종료 오류:', error);
    res.status(500).json({
      success: false,
      error: '타이머 종료에 실패했습니다.'
    });
  } finally {
    connection.release();
  }
});

// 진행 중인 세션 조회
router.get('/active', authenticateToken, async (req, res) => {
  try {
    const [activeSessions] = await pool.execute(
      'SELECT * FROM work_log WHERE uid = ? AND ended_at IS NULL ORDER BY started_at DESC',
      [req.user.uid]
    );

    res.json({
      success: true,
      active_sessions: activeSessions
    });

  } catch (error) {
    console.error('진행 중인 세션 조회 오류:', error);
    res.status(500).json({
      success: false,
      error: '진행 중인 세션을 조회할 수 없습니다.'
    });
  }
});

// 작업 로그 조회
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { 
      limit = 50, 
      offset = 0, 
      category, 
      date_from, 
      date_to,
      sort = 'desc'
    } = req.query;

    let whereConditions = ['uid = ?'];
    let queryParams = [req.user.uid];

    if (category && ['STUDY', 'EXERCISE', 'LANGUAGE', 'CERTIFICATE'].includes(category)) {
      whereConditions.push('category = ?');
      queryParams.push(category);
    }

    if (date_from) {
      whereConditions.push('DATE(created_at) >= ?');
      queryParams.push(date_from);
    }

    if (date_to) {
      whereConditions.push('DATE(created_at) <= ?');
      queryParams.push(date_to);
    }

    const orderDirection = sort.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    queryParams.push(parseInt(limit), parseInt(offset));

    const [workLogs] = await pool.execute(
      `SELECT 
         work_id, category, title, started_at, ended_at, duration, gained_exp, created_at
       FROM work_log 
       WHERE ${whereConditions.join(' AND ')}
       ORDER BY created_at ${orderDirection}
       LIMIT ? OFFSET ?`,
      queryParams
    );

    // 전체 개수 조회
    const countParams = queryParams.slice(0, -2);
    const [totalCount] = await pool.execute(
      `SELECT COUNT(*) as total FROM work_log WHERE ${whereConditions.join(' AND ')}`,
      countParams
    );

    res.json({
      success: true,
      work_logs: workLogs,
      pagination: {
        total: totalCount[0].total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        has_more: totalCount[0].total > parseInt(offset) + parseInt(limit)
      },
      filters: {
        category: category || 'all',
        date_from,
        date_to,
        sort
      }
    });

  } catch (error) {
    console.error('작업 로그 조회 오류:', error);
    res.status(500).json({
      success: false,
      error: '작업 로그를 조회할 수 없습니다.'
    });
  }
});

// 특정 작업 로그 조회
router.get('/:work_id', authenticateToken, async (req, res) => {
  try {
    const [workLog] = await pool.execute(
      'SELECT * FROM work_log WHERE work_id = ? AND uid = ?',
      [req.params.work_id, req.user.uid]
    );

    if (workLog.length === 0) {
      return res.status(404).json({
        success: false,
        error: '작업 로그를 찾을 수 없습니다.'
      });
    }

    res.json({
      success: true,
      work_log: workLog[0]
    });

  } catch (error) {
    console.error('작업 로그 상세 조회 오류:', error);
    res.status(500).json({
      success: false,
      error: '작업 로그를 조회할 수 없습니다.'
    });
  }
});

// 작업 로그 수정
router.put('/:work_id', authenticateToken, [
  body('title').optional().isLength({ max: 100 }).withMessage('제목은 100자 이하여야 합니다'),
  body('category').optional().isIn(['STUDY', 'EXERCISE', 'LANGUAGE', 'CERTIFICATE']).withMessage('유효한 카테고리를 선택하세요')
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

    const { title, category } = req.body;
    const updates = [];
    const values = [];

    if (title !== undefined) {
      updates.push('title = ?');
      values.push(title);
    }

    if (category !== undefined) {
      updates.push('category = ?');
      values.push(category);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: '수정할 정보가 없습니다.'
      });
    }

    values.push(req.params.work_id, req.user.uid);

    const [result] = await pool.execute(
      `UPDATE work_log SET ${updates.join(', ')} WHERE work_id = ? AND uid = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: '작업 로그를 찾을 수 없습니다.'
      });
    }

    // 수정된 로그 조회
    const [updatedLog] = await pool.execute(
      'SELECT * FROM work_log WHERE work_id = ? AND uid = ?',
      [req.params.work_id, req.user.uid]
    );

    res.json({
      success: true,
      work_log: updatedLog[0],
      message: '작업 로그가 수정되었습니다.'
    });

  } catch (error) {
    console.error('작업 로그 수정 오류:', error);
    res.status(500).json({
      success: false,
      error: '작업 로그 수정에 실패했습니다.'
    });
  }
});

// 작업 로그 삭제
router.delete('/:work_id', authenticateToken, async (req, res) => {
  try {
    const [result] = await pool.execute(
      'DELETE FROM work_log WHERE work_id = ? AND uid = ?',
      [req.params.work_id, req.user.uid]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: '작업 로그를 찾을 수 없습니다.'
      });
    }

    res.json({
      success: true,
      message: '작업 로그가 삭제되었습니다.'
    });

  } catch (error) {
    console.error('작업 로그 삭제 오류:', error);
    res.status(500).json({
      success: false,
      error: '작업 로그 삭제에 실패했습니다.'
    });
  }
});

// 카테고리별 통계
router.get('/stats/category', authenticateToken, async (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    
    let whereConditions = ['uid = ?'];
    let queryParams = [req.user.uid];

    if (date_from) {
      whereConditions.push('DATE(created_at) >= ?');
      queryParams.push(date_from);
    }

    if (date_to) {
      whereConditions.push('DATE(created_at) <= ?');
      queryParams.push(date_to);
    }

    const [stats] = await pool.execute(
      `SELECT 
         category,
         COUNT(*) as session_count,
         COALESCE(SUM(duration), 0) as total_duration,
         COALESCE(AVG(duration), 0) as avg_duration,
         COALESCE(SUM(gained_exp), 0) as total_exp,
         MIN(created_at) as first_session,
         MAX(created_at) as last_session
       FROM work_log 
       WHERE ${whereConditions.join(' AND ')} AND ended_at IS NOT NULL
       GROUP BY category
       ORDER BY total_duration DESC`,
      queryParams
    );

    res.json({
      success: true,
      category_stats: stats,
      period: {
        date_from: date_from || null,
        date_to: date_to || null
      }
    });

  } catch (error) {
    console.error('카테고리별 통계 조회 오류:', error);
    res.status(500).json({
      success: false,
      error: '카테고리별 통계를 조회할 수 없습니다.'
    });
  }
});

module.exports = router;