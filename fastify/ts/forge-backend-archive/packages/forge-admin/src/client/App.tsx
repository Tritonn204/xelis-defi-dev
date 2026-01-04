import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { DashboardView } from './views/Dashboard';
import { MacrosView } from './views/Macros';
import { MacroEditorView } from './views/MacroEditor';
import { SchemaView } from './views/Schema';
import { useState } from 'react';

export function App() {
  const { user, loading, login, logout } = useAuth();

  if (loading) {
    return (
      <div className="loading-container">
        <p>Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <LoginForm onLogin={login} />;
  }

  return (
    <BrowserRouter>
      <div className="app">
        <nav className="navbar">
          <h1>Forge Admin</h1>
          <div className="nav-links">
            <Link to="/">Dashboard</Link>
            <Link to="/macros">Query Macros</Link>
            <Link to="/schema">Schema</Link>
          </div>
          <div className="user-menu">
            <span>{user.email}</span>
            <button onClick={logout}>Logout</button>
          </div>
        </nav>

        <main className="content">
          <Routes>
            <Route path="/" element={<DashboardView />} />
            <Route path="/macros" element={<MacrosView />} />
            <Route path="/macros/new" element={<MacroEditorView />} />
            <Route path="/macros/:id" element={<MacroEditorView />} />
            <Route path="/schema" element={<SchemaView />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

function LoginForm({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await onLogin(email, password);
    } catch (err: any) {
      setError(err?.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <form className="login-form" onSubmit={handleSubmit}>
        <h1>Forge Admin Login</h1>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          required
          disabled={loading}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          required
          disabled={loading}
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Logging in...' : 'Login'}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}