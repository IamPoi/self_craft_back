const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { pool } = require('../config/database');
const router = express.Router();

// JWT 토큰 생성 함수
function generateToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30d' });
}

// 게스트 사용자 생성
router.post('/guest', async (req, res) => {
  try {
    const [result] = await pool.execute(
      `INSERT INTO user (provider, sns_id, name, is_guest, level, exp) 
       VALUES (NULL, NULL, '게스트', 1, 1, 0)`
    );

    const guestUser = {
      uid: result.insertId,
      name: '게스트',
      provider: null,
      is_guest: true,
      level: 1,
      exp: 0
    };

    const token = generateToken({ uid: guestUser.uid, is_guest: true });

    res.status(201).json({
      success: true,
      user: guestUser,
      token
    });

  } catch (error) {
    console.error('게스트 생성 오류:', error);
    res.status(500).json({
      success: false,
      error: '게스트 사용자 생성에 실패했습니다.'
    });
  }
});

// 구글 로그인/회원가입
router.post('/google', [
  body('google_id').notEmpty().withMessage('Google ID는 필수입니다'),
  body('email').isEmail().withMessage('유효한 이메일을 입력하세요'),
  body('name').notEmpty().withMessage('이름은 필수입니다')
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

    const { google_id, email, name, profile_url } = req.body;

    // 기존 사용자 확인
    const [existingUser] = await pool.execute(
      'SELECT * FROM user WHERE provider = "GOOGLE" AND sns_id = ?',
      [google_id]
    );

    let user;

    if (existingUser.length > 0) {
      // 기존 사용자 - 정보 업데이트
      user = existingUser[0];
      
      await pool.execute(
        `UPDATE user SET name = ?, email = ?, profile_url = ?, updated_at = NOW() 
         WHERE uid = ?`,
        [name, email, profile_url, user.uid]
      );
      
      user.name = name;
      user.email = email;
      user.profile_url = profile_url;
    } else {
      // 신규 사용자 생성
      const [result] = await pool.execute(
        `INSERT INTO user (provider, sns_id, email, name, profile_url, is_guest, level, exp) 
         VALUES ("GOOGLE", ?, ?, ?, ?, 0, 1, 0)`,
        [google_id, email, name, profile_url]
      );

      user = {
        uid: result.insertId,
        provider: 'GOOGLE',
        sns_id: google_id,
        email,
        name,
        profile_url,
        is_guest: false,
        level: 1,
        exp: 0
      };
    }

    const token = generateToken({ 
      uid: user.uid, 
      provider: 'GOOGLE',
      is_guest: false 
    });

    // 민감한 정보 제거
    delete user.sns_id;

    res.json({
      success: true,
      user,
      token
    });

  } catch (error) {
    console.error('구글 로그인 오류:', error);
    res.status(500).json({
      success: false,
      error: '구글 로그인에 실패했습니다.'
    });
  }
});

// 게스트 → 구글 계정 마이그레이션
router.post('/migrate-guest', [
  body('guest_uid').isInt().withMessage('게스트 UID는 숫자여야 합니다'),
  body('google_id').notEmpty().withMessage('Google ID는 필수입니다'),
  body('email').isEmail().withMessage('유효한 이메일을 입력하세요'),
  body('name').notEmpty().withMessage('이름은 필수입니다')
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

    const { guest_uid, google_id, email, name, profile_url } = req.body;

    // 게스트 사용자 확인
    const [guestUser] = await connection.execute(
      'SELECT * FROM user WHERE uid = ? AND is_guest = 1',
      [guest_uid]
    );

    if (guestUser.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        error: '게스트 사용자를 찾을 수 없습니다.'
      });
    }

    // 기존 구글 사용자 확인
    const [existingGoogle] = await connection.execute(
      'SELECT * FROM user WHERE provider = "GOOGLE" AND sns_id = ?',
      [google_id]
    );

    if (existingGoogle.length > 0) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        error: '이미 가입된 구글 계정입니다.'
      });
    }

    // 게스트를 구글 계정으로 업데이트
    await connection.execute(
      `UPDATE user SET 
         provider = "GOOGLE", 
         sns_id = ?, 
         email = ?, 
         name = ?, 
         profile_url = ?,
         is_guest = 0,
         updated_at = NOW()
       WHERE uid = ?`,
      [google_id, email, name, profile_url, guest_uid]
    );

    await connection.commit();

    const updatedUser = {
      uid: guest_uid,
      provider: 'GOOGLE',
      email,
      name,
      profile_url,
      is_guest: false,
      level: guestUser[0].level,
      exp: guestUser[0].exp
    };

    const token = generateToken({ 
      uid: guest_uid, 
      provider: 'GOOGLE',
      is_guest: false 
    });

    res.json({
      success: true,
      user: updatedUser,
      token,
      message: '게스트 계정이 구글 계정으로 성공적으로 전환되었습니다.'
    });

  } catch (error) {
    await connection.rollback();
    console.error('마이그레이션 오류:', error);
    res.status(500).json({
      success: false,
      error: '계정 전환에 실패했습니다.'
    });
  } finally {
    connection.release();
  }
});

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

// 토큰 검증 엔드포인트
router.get('/verify', authenticateToken, async (req, res) => {
  try {
    const [user] = await pool.execute(
      'SELECT uid, provider, email, name, profile_url, is_guest, level, exp FROM user WHERE uid = ?',
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
    console.error('토큰 검증 오류:', error);
    res.status(500).json({
      success: false,
      error: '토큰 검증에 실패했습니다.'
    });
  }
});

module.exports = router;