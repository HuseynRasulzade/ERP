const DOCUMENT_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  CANCELLED: 'Cancelled',
  DELETION_MARKED: 'Marked for deletion',
};

const POSTING_STATUS_LABEL: Record<string, string> = {
  NOT_POSTED: 'Not posted',
  POSTED: 'Posted',
  POSTING_FAILED: 'Posting failed',
};

const PERIOD_STATUS_LABEL: Record<string, string> = {
  OPEN: 'Open',
  SOFT_CLOSED: 'Soft closed',
  CLOSED: 'Closed',
};

/** Language-neutral status codes get a display label here — never persist a
 * translated label as the underlying value (section 52). */
export function StatusBadge({ kind, value }: { kind: 'document' | 'posting' | 'period'; value: string }) {
  const label =
    kind === 'document'
      ? (DOCUMENT_STATUS_LABEL[value] ?? value)
      : kind === 'posting'
        ? (POSTING_STATUS_LABEL[value] ?? value)
        : (PERIOD_STATUS_LABEL[value] ?? value);

  return <span className={`badge badge-${kind}-${value.toLowerCase()}`}>{label}</span>;
}
