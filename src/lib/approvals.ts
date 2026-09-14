// Shared approval types + labels (safe for client or server import).

export type ApprovalStatus = "pending" | "approved" | "rejected" | "changes_requested";

export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  changes_requested: "Changes requested",
};

export function isApprovalStatus(v: unknown): v is ApprovalStatus {
  return v === "pending" || v === "approved" || v === "rejected" || v === "changes_requested";
}

/** The three actions a reviewer can take, mapped to the resulting status. */
export const REVIEW_ACTIONS = {
  approve: "approved",
  reject: "rejected",
  request_changes: "changes_requested",
} as const;

export type ReviewAction = keyof typeof REVIEW_ACTIONS;

export interface ApprovalItem {
  id: string;
  title: string;
  content: string;
  prompt: string | null;
  mode: string | null;
  model: string | null;
  status: ApprovalStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  /** Only present on the admin queue. */
  submitter?: string | null;
}
