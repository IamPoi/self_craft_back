const mysql = require('mysql2/promise');
require('dotenv').config();

// MariaDB 연결 풀 생성
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: 'utf8mb4',
  collation: 'utf8mb4_unicode_ci',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  acquireTimeout: 60000,
  timeout: 60000
});

// 데이터베이스 연결 테스트
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('✅ MariaDB 연결 성공:', process.env.DB_HOST);
    
    // 문자셋 확인
    const [rows] = await connection.execute(
      "SELECT @@character_set_database, @@collation_database"
    );
    console.log('📊 DB 문자셋:', rows[0]);
    
    connection.release();
  } catch (error) {
    console.error('❌ MariaDB 연결 실패:', error.message);
    process.exit(1);
  }
}

module.exports = { pool, testConnection };