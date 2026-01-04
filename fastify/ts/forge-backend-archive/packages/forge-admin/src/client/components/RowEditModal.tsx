import { useState, useEffect } from 'react';
import { ColumnInfo } from '../types/database';

interface RowEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Record<string, any>) => Promise<void>;
  row: Record<string, any> | null;
  columns: ColumnInfo[];
  primaryKey: string;
}

export function RowEditModal({
  isOpen,
  onClose,
  onSave,
  row,
  columns,
  primaryKey,
}: RowEditModalProps) {
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (row) {
      setFormData({ ...row });
    }
  }, [row]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      // Don't send the primary key in updates
      const { [primaryKey]: _, ...updates } = formData;
      await onSave(updates);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen || !row) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-xl font-semibold text-gray-900">Edit Row</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            disabled={saving}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto max-h-[calc(80vh-140px)]">
          <div className="space-y-4">
            {columns.map((col) => {
              const isPrimaryKey = col.name === primaryKey;
              const value = formData[col.name] ?? '';

              return (
                <div key={col.name}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {col.name}
                    {isPrimaryKey && (
                      <span className="ml-2 text-xs text-blue-600 font-semibold">PRIMARY KEY</span>
                    )}
                    {!col.nullable && (
                      <span className="ml-2 text-xs text-red-600">*</span>
                    )}
                  </label>

                  {col.type.includes('text') || col.type === 'character varying' ? (
                    <textarea
                      value={value}
                      onChange={(e) =>
                        setFormData({ ...formData, [col.name]: e.target.value })
                      }
                      disabled={isPrimaryKey || saving}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                    />
                  ) : (
                    <input
                      type={getInputType(col.type)}
                      value={value}
                      onChange={(e) =>
                        setFormData({ ...formData, [col.name]: e.target.value })
                      }
                      disabled={isPrimaryKey || saving}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                    />
                  )}

                  <p className="mt-1 text-xs text-gray-500">
                    Type: {col.type} {col.nullable && '(nullable)'}
                    {col.default && ` • Default: ${col.default}`}
                  </p>
                </div>
              );
            })}
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <div className="mt-6 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function getInputType(dbType: string): string {
  if (dbType.includes('int') || dbType.includes('serial')) return 'number';
  if (dbType.includes('bool')) return 'checkbox';
  if (dbType.includes('date') || dbType.includes('timestamp')) return 'datetime-local';
  return 'text';
}