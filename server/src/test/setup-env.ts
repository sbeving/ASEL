// Runs before any test module imports — must set required env before
// config/env.ts's zod schema validates process.env at import time.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-0000000000';
process.env.JWT_EXPIRES = '1h';
process.env.BCRYPT_ROUNDS = '4';
process.env.MONGODB_URI = 'mongodb://placeholder:27017/__test__';
process.env.CORS_ORIGINS = 'http://localhost:5173';
