import { cn } from "../../lib/cn";

/** CSV 解析结果：表头粘性 + 横向滚动，行数很大时只渲染前 N 行。
 *  外壳（边框 / 顶部菜单 / 滚动容器）由 BodyViewer 统一提供，这里只出表格本体。 */
export const CsvTable = ({
  headers,
  rows,
  totalRows,
  visibleRows,
}: {
  headers: string[];
  rows: string[][];
  totalRows: number;
  visibleRows: number;
}) => (
  <div className="flex flex-col gap-2">
    <table className="px-table">
      <thead>
        <tr>
          {headers.map((header, index) => (
            <th key={`csv-header-${index}`} title={header}>
              {header || `Column ${index + 1}`}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={`csv-row-${rowIndex}`} className={cn(rowIndex % 2 === 1 && "bg-surface-2/40")}>
            {row.map((cell, cellIndex) => (
              <td key={`csv-cell-${rowIndex}-${cellIndex}`} className="font-mono text-[12px]">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
    {totalRows > visibleRows ? (
      <p className="m-0 text-[11px] text-fg-dim">
        仅展示前 {visibleRows} 行，完整行数 {totalRows}；导出 JSON 可拿到全部数据。
      </p>
    ) : null}
  </div>
);
