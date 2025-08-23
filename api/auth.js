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

// JWT 토큰 생성
const generateToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30d' });
};

module.exports = async (req, res) => {
  try {
    // CORS 설정
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    const { url, method } = req;

    // POST /api/auth/guest - 게스트 사용자 생성
    if (url === '/api/auth/guest' && method === 'POST') {
      const connection = await getConnection();
      
      try {
        const [result] = await connection.execute(
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

        return res.status(201).json({
          success: true,
          user: guestUser,
          token,
          message: '게스트 사용자가 생성되었습니다.'
        });

      } finally {
        await connection.end();
      }
    }

    // POST /api/auth/google - 구글 로그인/회원가입
    if (url === '/api/auth/google' && method === 'POST') {
      const body = JSON.parse(req.body || '{}');
      const { google_id, email, name, profile_url } = body;

      if (!google_id || !email || !name) {
        return res.status(400).json({
          success: false,
          error: 'Google ID, email, name은 필수입니다.'
        });
      }

      const connection = await getConnection();
      
      try {
        // 기존 사용자 확인
        const [existingUser] = await connection.execute(
          'SELECT * FROM user WHERE provider = "GOOGLE" AND sns_id = ?',
          [google_id]
        );

        let user;

        if (existingUser.length > 0) {
          // 기존 사용자 - 정보 업데이트
          user = existingUser[0];
          
          await connection.execute(
            `UPDATE user SET name = ?, email = ?, profile_url = ?, updated_at = NOW() 
             WHERE uid = ?`,
            [name, email, profile_url, user.uid]
          );
          
          user.name = name;
          user.email = email;
          user.profile_url = profile_url;
        } else {
          // 신규 사용자 생성
          const [result] = await connection.execute(
            `INSERT INTO user (provider, sns_id, email, name, profile_url, is_guest, level, exp) 
             VALUES ("GOOGLE", ?, ?, ?, ?, 0, 1, 0)`,
            [google_id, email, name, profile_url]
          );

          user = {
            uid: result.insertId,
            provider: 'GOOGLE',
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

        return res.json({
          success: true,
          user,
          token,
          message: existingUser.length > 0 ? '로그인 성공' : '회원가입 완료'
        });

      } finally {
        await connection.end();
      }
    }

    // POST /api/auth/migrate-guest - 게스트 → 구글 계정 전환
    if (url === '/api/auth/migrate-guest' && method === 'POST') {
      const body = JSON.parse(req.body || '{}');
      const { guest_uid, google_id, email, name, profile_url } = body;

      if (!guest_uid || !google_id || !email || !name) {
        return res.status(400).json({
          success: false,
          error: '필수 정보가 누락되었습니다.'
        });
      }

      const connection = await getConnection();
      
      try {
        await connection.beginTransaction();

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

        return res.json({
          success: true,
          user: updatedUser,
          token,
          message: '게스트 계정이 구글 계정으로 성공적으로 전환되었습니다.'
        });

      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        await connection.end();
      }
    }

    // 지원하지 않는 경로
    return res.status(404).json({
      success: false,
      error: 'Route not found',
      available_routes: [
        'POST /api/auth/guest',
        'POST /api/auth/google',
        'POST /api/auth/migrate-guest'
      ]
    });

  } catch (error) {
    console.error('❌ Auth API Error:', error);
    return res.status(500).json({
      success: false,
      error: '서버 오류가 발생했습니다.',
      details: error.message, // 항상 오류 메시지 표시 (디버깅용)
      env_debug: {
        DB_HOST: !!process.env.DB_HOST,
        DB_NAME: !!process.env.DB_NAME,
        DB_USER: !!process.env.DB_USER
      }
    });
  }
};