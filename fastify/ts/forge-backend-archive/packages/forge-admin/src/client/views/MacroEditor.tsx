import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { useApi } from '../hooks/useApi';

// Add type definitions
interface SchemaTable {
  name: string;
  columns: Array<{
    name: string;
    type: string;
    nullable: boolean;
    default: string | null;
  }>;
  indexes: Array<{
    name: string;
    columns: string[];
    unique: boolean;
    primary: boolean;
  }>;
}

interface Schema {
  tables: SchemaTable[];
  version: number;
}

interface MacroData {
  id?: number;
  name: string;
  description: string;
  sql: string;
  category: 'monitoring' | 'maintenance' | 'rollback' | 'custom';
  requires_confirmation: boolean;
  parameters?: Array<{
    name: string;
    type: 'number' | 'string' | 'date';
    description?: string;
  }>;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
  requiresBatching?: boolean;
  estimatedRows?: number;
  recommendedBatchSize?: number;
}

interface ExecutionResult {
  success: boolean;
  rowsAffected: number;
  executionTimeMs: number;
  data?: Record<string, any>[];
  totalRowsAffected?: number;
  batchesExecuted?: number;
}

interface ExecutionHistory {
  id: number;
  executed_by_name: string;
  executed_by_email: string;
  executed_at: string;
  success: boolean;
  rows_affected: number;
  execution_time_ms: number;
  error_message?: string;
  parameters?: any;
}

// Parameter form component with proper typing
interface ParameterFormProps {
  parameters: MacroData['parameters'];
  values: Record<string, any>;
  onChange: (name: string, value: any) => void;
}

function ParameterForm({ parameters, values, onChange }: ParameterFormProps) {
  if (!parameters || parameters.length === 0) {
    return null;
  }

  return (
    <div className="parameter-form">
      <h4>Parameters</h4>
      {parameters.map(param => (
        <div key={param.name} className="form-group">
          <label>{param.name} ({param.type})</label>
          {param.type === 'date' ? (
            <input
              type="datetime-local"
              value={values[param.name] || ''}
              onChange={e => onChange(param.name, e.target.value)}
            />
          ) : param.type === 'number' ? (
            <input
              type="number"
              value={values[param.name] || ''}
              onChange={e => onChange(param.name, Number(e.target.value))}
            />
          ) : (
            <input
              type="text"
              value={values[param.name] || ''}
              onChange={e => onChange(param.name, e.target.value)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export function MacroEditorView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { apiFetch, loading, error } = useApi();
  
  const [schema, setSchema] = useState<Schema | null>(null);
  const [macro, setMacro] = useState<MacroData>({
    name: '',
    description: '',
    sql: '',
    category: 'custom',
    requires_confirmation: true,
  });
  
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [testParams, setTestParams] = useState<string>('[]');
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);
  const [executions, setExecutions] = useState<ExecutionHistory[]>([]);

  // Load schema on mount
  useEffect(() => {
    apiFetch('/api/schema/info')
      .then((data: Schema) => setSchema(data))
      .catch(err => console.error('Failed to load schema:', err));
  }, [apiFetch]);

  // Load execution history
  useEffect(() => {
    if (id) {
      apiFetch(`/api/macros/${id}/executions`)
        .then((data: ExecutionHistory[]) => setExecutions(data))
        .catch(err => console.error('Failed to load executions:', err));
    }
  }, [id, apiFetch]);

  // Load macro if editing
  useEffect(() => {
    if (id) {
      apiFetch(`/api/macros/${id}`)
        .then((data: MacroData) => {
          setMacro({
            name: data.name,
            description: data.description,
            sql: data.sql,
            category: data.category,
            requires_confirmation: data.requires_confirmation,
          });
        })
        .catch(err => console.error('Failed to load macro:', err));
    }
  }, [id, apiFetch]);

  const handleSave = async (): Promise<void> => {
    try {
      const endpoint = id ? `/api/macros/${id}` : '/api/macros';
      const method = id ? 'PUT' : 'POST';
      
      await apiFetch(endpoint, {
        method,
        body: JSON.stringify(macro),
      });
      
      navigate('/macros');
    } catch (err) {
      console.error('Failed to save macro:', err);
    }
  };

  const handleDryRun = async (): Promise<void> => {
    if (!id) return;

    try {
      const params = JSON.parse(testParams);
      const result: ValidationResult = await apiFetch(`/api/macros/${id}/execute`, {
        method: 'POST',
        body: JSON.stringify({ parameters: params, dryRun: true }),
      });
      setValidation(result);
    } catch (err) {
      console.error('Dry run failed:', err);
      setValidation({
        valid: false,
        error: 'Failed to analyze query'
      });
    }
  };

  const handleExecute = async (): Promise<void> => {
    if (!id) return;
    
    if (macro.requires_confirmation && !confirm('Execute this query?')) {
      return;
    }

    try {
      const params = JSON.parse(testParams);
      const result: ExecutionResult = await apiFetch(`/api/macros/${id}/execute`, {
        method: 'POST',
        body: JSON.stringify({ parameters: params }),
      });
      
      setExecutionResult(result);
      
      // Reload execution history
      const updatedExecutions: ExecutionHistory[] = await apiFetch(`/api/macros/${id}/executions`);
      setExecutions(updatedExecutions);
    } catch (err) {
      console.error('Execution failed:', err);
    }
  };

  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    setMacro({ 
      ...macro, 
      category: e.target.value as MacroData['category']
    });
  };

  return (
    <div className="macro-editor">
      <h1>{id ? 'Edit' : 'New'} Macro</h1>

      <div className="form-group">
        <label>Name</label>
        <input
          type="text"
          value={macro.name}
          onChange={e => setMacro({ ...macro, name: e.target.value })}
          placeholder="Descriptive name"
        />
      </div>

      <div className="form-group">
        <label>Description</label>
        <textarea
          value={macro.description}
          onChange={e => setMacro({ ...macro, description: e.target.value })}
          placeholder="What does this query do?"
          rows={3}
        />
      </div>

      <div className="form-group">
        <label>Category</label>
        <select
          value={macro.category}
          onChange={handleCategoryChange}
        >
          <option value="monitoring">Monitoring</option>
          <option value="maintenance">Maintenance</option>
          <option value="rollback">Rollback</option>
          <option value="custom">Custom</option>
        </select>
      </div>

      <div className="form-group">
        <label>
          <input
            type="checkbox"
            checked={macro.requires_confirmation}
            onChange={e => setMacro({ ...macro, requires_confirmation: e.target.checked })}
          />
          Require confirmation before execution
        </label>
      </div>

      <div className="form-group">
        <label>SQL Query</label>
        <Editor
          height="300px"
          language="sql"
          value={macro.sql}
          onChange={value => setMacro({ ...macro, sql: value || '' })}
          onMount={(editor, monaco) => {
            if (schema) {
              // Register SQL completion provider
              monaco.languages.registerCompletionItemProvider('sql', {
                provideCompletionItems: (model, position) => {
                  const word = model.getWordUntilPosition(position);
                  const range = {
                    startLineNumber: position.lineNumber,
                    endLineNumber: position.lineNumber,
                    startColumn: word.startColumn,
                    endColumn: word.endColumn,
                  };
                  return {
                    suggestions: [
                      ...schema.tables.map(t => ({
                        label: t.name,
                        kind: monaco.languages.CompletionItemKind.Class,
                        insertText: t.name,
                        detail: `Table (${t.columns.length} columns)`,
                        range,
                      })),
                      ...schema.tables.flatMap(t => 
                        t.columns.map(c => ({
                          label: `${t.name}.${c.name}`,
                          kind: monaco.languages.CompletionItemKind.Field,
                          insertText: c.name,
                          detail: `${c.type}${c.nullable ? ' (nullable)' : ''}`,
                          range,
                        }))
                      ),
                    ]
                  };
                }
              });
            }
          }}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            wordWrap: 'on',
            suggest: { showKeywords: true },
          }}
        />
      </div>

      {id && (
        <>
          <div className="form-group">
            <label>Test Parameters (JSON array)</label>
            <input
              type="text"
              value={testParams}
              onChange={e => setTestParams(e.target.value)}
              placeholder='[1704067200000]'
            />
          </div>

          <div className="button-group">
            <button onClick={handleDryRun} className="btn">
              Dry Run (Analyze)
            </button>
            <button onClick={handleExecute} className="btn btn-primary">
              Execute
            </button>
          </div>

          {validation && (
            <div className="validation-result">
              <h3>Analysis</h3>
              <p>Estimated rows: {validation.estimatedRows ?? 'Unknown'}</p>
              {validation.requiresBatching && (
                <p className="warning">
                  ⚠️ This query will be executed in batches of {validation.recommendedBatchSize}
                </p>
              )}
              {!validation.valid && validation.error && (
                <p className="error">❌ {validation.error}</p>
              )}
            </div>
          )}
        </>
      )}

      {error && <p className="error">{error}</p>}

      {executionResult && (
        <div className="execution-result">
          <h3>Execution Result</h3>
          <p>✅ {executionResult.rowsAffected} rows affected in {executionResult.executionTimeMs}ms</p>
          
          {executionResult.data && executionResult.data.length > 0 && (
            <div className="results-table-container">
              <table className="results-table">
                <thead>
                  <tr>
                    {Object.keys(executionResult.data[0]).map(key => (
                      <th key={key}>{key}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {executionResult.data.slice(0, 100).map((row, i) => (
                    <tr key={i}>
                      {Object.values(row).map((val, j) => (
                        <td key={j}>{val == null ? 'NULL' : String(val)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {executionResult.data.length > 100 && (
                <p className="results-notice">
                  Showing first 100 of {executionResult.data.length} rows
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="button-group">
        <button onClick={() => navigate('/macros')} className="btn">
          Cancel
        </button>
        <button onClick={handleSave} disabled={loading} className="btn btn-primary">
          {loading ? 'Saving...' : 'Save'}
        </button>
      </div>

      {id && executions.length > 0 && (
        <div className="execution-history">
          <h3>Recent Executions</h3>
          {executions.map(exec => (
            <div key={exec.id} className="execution-item">
              <span className={exec.success ? 'success' : 'error'}>
                {exec.success ? '✅' : '❌'}
              </span>
              <span>{exec.executed_by_name || exec.executed_by_email}</span>
              <span>{new Date(exec.executed_at).toLocaleString()}</span>
              <span>{exec.rows_affected || 0} rows</span>
              <span>{exec.execution_time_ms || 0}ms</span>
              {!exec.success && exec.error_message && (
                <span className="error-message" title={exec.error_message}>
                  Error
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}