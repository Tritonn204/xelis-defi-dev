import csrf from 'csurf';
import type { Config } from '../config';

export function createCsrfMiddleware(config: Config) {
  return csrf({
    cookie: {
      httpOnly: true,
      secure: config.CSRF_SECURE_COOKIE,
      sameSite: 'strict',
      maxAge: 4 * 60 * 60 * 1000
    }
  });
}