import { useMemo, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  ColumnDef,
  flexRender,
  SortingState,
} from '@tanstack/react-table';
import { useTableData } from '../hooks/useTableData';
import { RowEditModal } from './RowEditModal';
import { ColumnInfo } from '../types/database';
import { useApi } from '../hooks/useApi';

interface TableBrowserProps {
  tableName: string;
  columns: ColumnInfo[];
  primaryKey: string;
}

export function TableBrowser({ tableName, columns, primaryKey }: TableBrowserProps) {
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [editingRow, setEditingRow] = useState<Record<string, any> | null>(null);

  const sortBy = sorting[0]?.id;
  const sortOrder = sorting[0]?.desc ? 'DESC' : 'ASC';

  const { data, total, totalPages, loading, error, refetch } = useTableData({
    tableName,
    page,
    pageSize,
    sortBy,
    sortOrder,
  });

  const { apiFetch } = useApi();

  // Define table columns dynamically based on schema
  const tableColumns = useMemo<ColumnDef<any>[]>(() => {
    const dataColumns: ColumnDef<any>[] = columns.map((col) => ({
      accessorKey: col.name,
      header: col.name,
      cell: (info) => {
        const value = info.getValue();
        
        // Handle null values
        if (value === null || value === undefined) {
          return <span className="text-gray-400 italic">NULL</span>;
        }

        // Truncate long strings
        const stringValue = String(value);
        if (stringValue.length > 50) {
          return (
            <span title={stringValue}>
              {stringValue.substring(0, 50)}...
            </span>
          );
        }

        return <span>{stringValue}</span>;
      },
    }));

    // Add actions column
    dataColumns.push({
      id: 'actions',
      header: 'Actions',
      cell: (info) => (
        <div className="flex space-x-2">
          <button
            onClick={() => setEditingRow(info.row.original)}
            className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Edit
          </button>
          <button
            onClick={() => handleDelete(info.row.original)}
            className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
          >
            Delete
          </button>
        </div>
      ),
    });

    return dataColumns;
  }, [columns]);

  const table = useReactTable({
    data,
    columns: tableColumns,
    state: {
      sorting,
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualSorting: true,
    manualPagination: true,
    pageCount: totalPages,
  });

  const handleSave = async (updates: Record<string, any>) => {
    if (!editingRow) return;

    const id = editingRow[primaryKey];
    await apiFetch(`/api/tables/${tableName}/row/${id}`, {
      method: 'PUT',
      body: updates,
    });

    await refetch();
  };

  const handleDelete = async (row: Record<string, any>) => {
    if (!confirm('Are you sure you want to delete this row?')) return;

    const id = row[primaryKey];
    await apiFetch(`/api/tables/${tableName}/row/${id}`, {
      method: 'DELETE',
    });

    await refetch();
  };

  if (loading && data.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading table data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-md">
        <p className="text-sm text-red-800">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Table */}
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <div className="flex items-center space-x-1">
                      <span>
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                      </span>
                      {header.column.getIsSorted() && (
                        <span>
                          {header.column.getIsSorted() === 'desc' ? ' 🔽' : ' 🔼'}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="hover:bg-gray-50">
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap"
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border border-gray-200 rounded-lg">
        <div className="flex items-center space-x-2">
          <span className="text-sm text-gray-700">
            Showing <span className="font-medium">{(page - 1) * pageSize + 1}</span> to{' '}
            <span className="font-medium">
              {Math.min(page * pageSize, total)}
            </span>{' '}
            of <span className="font-medium">{total}</span> results
          </span>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>

          <span className="text-sm text-gray-700">
            Page <span className="font-medium">{page}</span> of{' '}
            <span className="font-medium">{totalPages}</span>
          </span>

          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      </div>

      {/* Edit Modal */}
      <RowEditModal
        isOpen={!!editingRow}
        onClose={() => setEditingRow(null)}
        onSave={handleSave}
        row={editingRow}
        columns={columns}
        primaryKey={primaryKey}
      />
    </div>
  );
}