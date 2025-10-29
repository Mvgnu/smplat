"use client";

import type { ReactNode } from "react";

// meta: component: AdminDataTable
// meta: owner: platform

export type AdminDataTableColumn<T> = {
  key: keyof T | string;
  header: ReactNode;
  width?: string;
  align?: "left" | "center" | "right";
  render?: (row: T) => ReactNode;
};

export type AdminDataTableProps<T> = {
  columns: AdminDataTableColumn<T>[];
  data: T[];
  emptyState?: ReactNode;
  rowKey: (row: T) => string;
};

export function AdminDataTable<T>({ columns, data, emptyState, rowKey }: AdminDataTableProps<T>) {
  if (data.length === 0) {
    return (
      <div className="flex min-h-[12rem] items-center justify-center rounded-3xl border border-white/10 bg-black/30 p-12 text-center text-sm text-white/60">
        {emptyState ?? "No records found."}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/30">
      <table className="w-full table-fixed text-left text-sm text-white/80">
        <thead className="bg-white/5 text-xs uppercase tracking-[0.3em] text-white/40">
          <tr>
            {columns.map((column) => (
              <th
                key={String(column.key)}
                className={`px-5 py-4 font-semibold ${
                  column.align === "right"
                    ? "text-right"
                    : column.align === "center"
                      ? "text-center"
                      : "text-left"
                }`}
                style={column.width ? { width: column.width } : undefined}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {data.map((row) => (
            <tr key={rowKey(row)} className="transition hover:bg-white/5">
              {columns.map((column) => {
                const value = column.render ? column.render(row) : (row as any)[column.key as keyof T];
                return (
                  <td
                    key={String(column.key)}
                    className={`px-5 py-4 ${
                      column.align === "right"
                        ? "text-right"
                        : column.align === "center"
                          ? "text-center"
                          : "text-left"
                    }`}
                  >
                    {value}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
