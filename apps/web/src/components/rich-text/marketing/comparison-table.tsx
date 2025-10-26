// meta: marketing-block: comparison-table

type ComparisonColumn = {
  label?: string;
  highlight?: boolean;
  footnote?: string;
};

type ComparisonRow = {
  label?: string;
  values: Array<string | boolean | null>;
};

type ComparisonTableProps = {
  heading?: string;
  subheading?: string;
  columns: ComparisonColumn[];
  rows: ComparisonRow[];
};

const toCellDisplay = (value: string | boolean | null | undefined) => {
  if (typeof value === "boolean") {
    return value ? "✓" : "—";
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  return "—";
};

export function ComparisonTable({ heading, subheading, columns, rows }: ComparisonTableProps) {
  const validColumns = columns.filter((column) => column.label);
  const validRows = rows.filter((row) => row.label);

  if (validColumns.length === 0 || validRows.length === 0) {
    return null;
  }

  const columnCount = validColumns.length;

  return (
    <section className="space-y-6">
      {heading ? <h3 className="text-2xl font-semibold text-white">{heading}</h3> : null}
      {subheading ? <p className="max-w-3xl text-white/70">{subheading}</p> : null}
      <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
        <table className="w-full border-collapse text-left text-sm text-white/80">
          <thead className="bg-white/10 text-white">
            <tr>
              <th className="px-6 py-4 font-semibold">Features</th>
              {validColumns.map((column, index) => (
                <th
                  key={column.label ?? index}
                  className={`px-6 py-4 font-semibold ${column.highlight ? "bg-white/10" : ""}`}
                >
                  <div className="flex flex-col gap-1">
                    <span>{column.label}</span>
                    {column.footnote ? (
                      <span className="text-xs font-normal text-white/60">{column.footnote}</span>
                    ) : null}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {validRows.map((row, rowIndex) => (
              <tr key={row.label ?? rowIndex} className="border-t border-white/10">
                <th className="bg-white/5 px-6 py-4 font-medium text-white">{row.label}</th>
                {validColumns.map((_, columnIndex) => {
                  const value = row.values[columnIndex];
                  return (
                    <td key={columnIndex} className="px-6 py-4 text-center">
                      {toCellDisplay(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-white/50">
        Columns compared: {columnCount}
      </p>
    </section>
  );
}

export type { ComparisonColumn, ComparisonRow };
