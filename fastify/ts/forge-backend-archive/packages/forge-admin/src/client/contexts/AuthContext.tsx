import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { sendJSON } from '../util/api';

interface User {
  id: number;
  email: string;
  full_name: string;
  has_2fa: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {  // <-- Added return type
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const verifySession = async () => {
      try {
        const data = await sendJSON('POST', '/api/auth/verify');
        setUser(data.user);
      } catch (err) {
        console.log('No existing session, user needs to log in');
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    verifySession();
  }, []);

  const login = async (email: string, password: string): Promise<void> => {
    console.log(`Calling LOGIN`);
    const data = await sendJSON('POST', '/api/auth/login', { email, password });
    
    if (data.requiresTOTP) {
      throw new Error('2FA_REQUIRED');
    }
    
    setUser(data.user);
  };

  const logout = async (): Promise<void> => {
    try {
      await sendJSON('POST', '/api/auth/logout');
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}