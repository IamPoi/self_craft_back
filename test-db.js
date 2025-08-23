const mysql = require('mysql2/promise');
require('dotenv').config();

// DB 연결 테스트
async function testDBConnection() {
  console.log('🔄 MariaDB 연결 테스트 시작...');
  
  try {
    // 환경변수 확인
    console.log('\n📊 환경변수 체크:');
    console.log({
      DB_HOST: process.env.DB_HOST || 'NOT SET',
      DB_PORT: process.env.DB_PORT || 'NOT SET',
      DB_USER: process.env.DB_USER || 'NOT SET',
      DB_PASSWORD: process.env.DB_PASSWORD ? 'SET' : 'NOT SET',
      DB_NAME: process.env.DB_NAME || 'NOT SET'
    });

    // DB 연결 시도
    console.log('\n🔗 DB 연결 시도 중...');
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      charset: 'utf8mb4',
      collation: 'utf8mb4_unicode_ci'
    });
    
    console.log('✅ DB 연결 성공!');

    // 간단한 쿼리 테스트
    console.log('\n🧪 쿼리 테스트 중...');
    const [rows] = await connection.execute('SELECT VERSION() as version, NOW() as current_time_col');
    console.log('📊 DB 정보:', rows[0]);

    // 테이블 존재 확인
    console.log('\n📋 테이블 확인 중...');
    const [tables] = await connection.execute(`
      SELECT TABLE_NAME 
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = ?
    `, [process.env.DB_NAME]);
    
    console.log('🗂️ 존재하는 테이블들:', tables.map(t => t.TABLE_NAME));

    await connection.end();
    console.log('\n🎉 모든 테스트 완료!');
    
  } catch (error) {
    console.error('\n❌ 연결 실패:', error.message);
    console.error('상세 오류:', error);
  }
}

testDBConnection();