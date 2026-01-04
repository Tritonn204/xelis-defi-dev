import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';

export function MacrosView() {
  const { apiFetch, loading } = useApi();
  const [macros, setMacros] = useState<any[]>([]);

  const loadMacros = () => {
    apiFetch('/api/macros').then(setMacros);
  };

  useEffect(() => {
    loadMacros();
  }, [apiFetch]);

  const deleteMacro = async (id: number, name: string) => {
    if (!confirm(`Delete macro "${name}"?`)) return;
    
    await apiFetch(`/api/macros/${id}`, { method: 'DELETE' });
    loadMacros();
  };

  return (
    <div className="macros-view">
      <div className="header">
        <h1>Query Macros</h1>
        <Link to="/macros/new" className="btn btn-primary">
          New Macro
        </Link>
      </div>

      {loading && <p>Loading...</p>}
      
      <div className="macros-list">
        {macros.map(macro => (
          <div key={macro.id} className="macro-card">
            <div className="macro-header">
              <h3>{macro.name}</h3>
              <span className={`badge badge-${macro.category}`}>
                {macro.category}
              </span>
            </div>
            <p className="macro-description">{macro.description}</p>
            <div className="macro-meta">
              <span>Created by {macro.created_by_name || macro.created_by_email}</span>
              <span>{new Date(macro.created_at).toLocaleDateString()}</span>
            </div>
            <div className="macro-actions">
              <Link to={`/macros/${macro.id}`} className="btn btn-sm">
                Edit
              </Link>
              <button 
                onClick={() => deleteMacro(macro.id, macro.name)}
                className="btn btn-sm btn-danger"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}