// 간단한 테스트용 API
module.exports = (req, res) => {
  try {
    // 환경변수 확인
    const env_check = {
      DB_HOST: !!process.env.DB_HOST,
      DB_PASSWORD: !!process.env.DB_PASSWORD,
      JWT_SECRET: !!process.env.JWT_SECRET,
      NODE_ENV: process.env.NODE_ENV
    };

    res.status(200).json({
      message: '🎉 Test API Working!',
      timestamp: new Date().toISOString(),
      platform: 'Vercel Serverless Function',
      env_variables: env_check,
      node_version: process.version
    });
    
  } catch (error) {
    res.status(500).json({
      error: error.message,
      stack: error.stack
    });
  }
};