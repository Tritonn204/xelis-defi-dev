export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
}

export interface TableSchema {
  name: string;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
}

export interface TableDataResponse {
  data: Record<string, any>[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PrimaryKeyInfo {
  columnName: string;
}