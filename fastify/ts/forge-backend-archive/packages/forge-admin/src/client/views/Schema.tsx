import { useState, useEffect } from 'react';
import { useApi } from '../hooks/useApi';
import { TableBrowser } from '../components/TableBrowser';
import { TableSchema } from '../types/database';

type TabType = 'data' | 'schema';

export function SchemaView() {
  const { apiFetch, loading } = useApi();
  const [schema, setSchema] = useState<{ tables: TableSchema[] } | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('data');
  const [searchQuery, setSearchQuery] = useState('');

  const loadSchema = async () => {
    const result = await apiFetch('/api/schema/info');
    setSchema(result);
    
    // Auto-select first table
    if (result.tables.length > 0 && !selectedTable) {
      setSelectedTable(result.tables[0].name);
    }
  };

  useEffect(() => {
    loadSchema();
  }, []);

  const refreshSchema = async () => {
    await apiFetch('/api/schema/refresh', { method: 'POST' });
    await loadSchema();
  };

  const table = schema?.tables.find((t) => t.name === selectedTable);
  const primaryKey = table?.indexes.find((idx) => idx.primary)?.columns[0] || 'id';

  const filteredTables = schema?.tables.filter((t) =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Tables</h2>
          <input
            type="text"
            placeholder="Search tables..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && <p className="p-4 text-sm text-gray-500">Loading...</p>}
          {filteredTables?.map((t) => (
            <div
              key={t.name}
              onClick={() => {
                setSelectedTable(t.name);
                setActiveTab('data');
              }}
              className={`px-4 py-2 cursor-pointer text-sm hover:bg-gray-50 ${
                selectedTable === t.name
                  ? 'bg-blue-50 text-blue-700 font-medium border-l-4 border-blue-700'
                  : 'text-gray-700'
              }`}
            >
              {t.name}
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-gray-200">
          <button
            onClick={refreshSchema}
            className="w-full px-3 py-2 bg-gray-100 text-gray-700 rounded-md text-sm hover:bg-gray-200"
          >
            Refresh Schema
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        {table ? (
          <div className="p-6">
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-gray-900 mb-2">{table.name}</h1>
              
              {/* Tabs */}
              <div className="border-b border-gray-200">
                <nav className="-mb-px flex space-x-8">
                  <button
                    onClick={() => setActiveTab('data')}
                    className={`py-2 px-1 border-b-2 font-medium text-sm ${
                      activeTab === 'data'
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    Data
                  </button>
                  <button
                    onClick={() => setActiveTab('schema')}
                    className={`py-2 px-1 border-b-2 font-medium text-sm ${
                      activeTab === 'schema'
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    Schema Info
                  </button>
                </nav>
              </div>
            </div>

            {/* Tab Content */}
            {activeTab === 'data' && (
              <TableBrowser
                tableName={table.name}
                columns={table.columns}
                primaryKey={primaryKey}
              />
            )}

            {activeTab === 'schema' && (
              <div className="space-y-6">
                {/* Columns */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">Columns</h3>
                  <div className="overflow-x-auto border border-gray-200 rounded-lg">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                            Name
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                            Type
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                            Nullable
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                            Default
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {table.columns.map((col) => (
                          <tr key={col.name} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm font-mono text-gray-900">
                              {col.name}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-700">
                              {col.type}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-700">
                              {col.nullable ? 'Yes' : 'No'}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-700">
                              {col.default || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Indexes */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">Indexes</h3>
                  <div className="space-y-2">
                    {table.indexes.map((idx) => (
                      <div
                        key={idx.name}
                        className="p-3 bg-gray-50 border border-gray-200 rounded-md"
                      >
                        <div className="flex items-center space-x-2">
                          <code className="text-sm font-mono text-gray-900">
                            {idx.name}
                          </code>
                          {idx.primary && (
                            <span className="px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-800 rounded">
                              PRIMARY
                            </span>
                          )}
                          {idx.unique && (
                            <span className="px-2 py-0.5 text-xs font-semibold bg-green-100 text-green-800 rounded">
                              UNIQUE
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-gray-600">
                          on {idx.columns.join(', ')}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-500">Select a table to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}