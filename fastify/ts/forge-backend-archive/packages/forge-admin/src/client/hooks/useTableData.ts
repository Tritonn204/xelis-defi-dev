import { useState, useEffect, useCallback } from 'react';
import { useApi } from './useApi';
import { TableDataResponse } from '../types/database';

interface UseTableDataOptions {
  tableName: string;
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
}

export function useTableData({
  tableName,
  page,
  pageSize,
  sortBy,
  sortOrder = 'ASC',
}: UseTableDataOptions) {
  const { apiFetch } = useApi();
  const [data, setData] = useState<TableDataResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!tableName) return;

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
        ...(sortBy && { sortBy, sortOrder }),
      });

      const result = await apiFetch(`/api/tables/${tableName}/data?${params}`);
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch table data');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [tableName, page, pageSize, sortBy, sortOrder, apiFetch]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    data: data?.data || [],
    total: data?.total || 0,
    page: data?.page || 1,
    pageSize: data?.pageSize || 50,
    totalPages: data?.totalPages || 0,
    loading,
    error,
    refetch: fetchData,
  };
}