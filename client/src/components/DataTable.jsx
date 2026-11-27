export default function DataTable({
  columns, rows, loading, emptyMessage = 'No records found.',
  search, onSearchChange, searchPlaceholder = 'Search…',
  toolbar, rowActions, pagination
}) {
  return (
    <div>
      {(onSearchChange || toolbar) && (
        <div className="table-toolbar">
          {onSearchChange && (
            <input
              className="search-input"
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          )}
          <div className="spacer" />
          {toolbar}
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((col) => <th key={col.key}>{col.label}</th>)}
              {rowActions ? <th className="actions-th">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={columns.length + (rowActions ? 1 : 0)} className="muted">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={columns.length + (rowActions ? 1 : 0)} className="muted">{emptyMessage}</td></tr>
            ) : (
              rows.map((row, idx) => (
                <tr key={row.id ?? idx}>
                  {columns.map((col) => (
                    <td key={col.key}>{col.render ? col.render(row) : row[col.key]}</td>
                  ))}
                  {rowActions ? <td className="actions-td"><div className="actions-cell">{rowActions(row)}</div></td> : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {pagination && pagination.total > pagination.limit && (
        <div className="pagination">
          <span className="muted">
            {(pagination.page - 1) * pagination.limit + 1}
            {'–'}
            {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
          </span>
          <button type="button" className="btn-ghost btn-sm" disabled={pagination.page <= 1} onClick={() => pagination.onPageChange(pagination.page - 1)}>Prev</button>
          <button type="button" className="btn-ghost btn-sm" disabled={pagination.page * pagination.limit >= pagination.total} onClick={() => pagination.onPageChange(pagination.page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
