import { describe, it, expect } from "vitest";
import {
  isApprovalStatus,
  REVIEW_ACTIONS,
  APPROVAL_STATUS_LABEL,
} from "@/lib/approvals";

describe("approvals", () => {
  it("validates known statuses", () => {
    expect(isApprovalStatus("pending")).toBe(true);
    expect(isApprovalStatus("approved")).toBe(true);
    expect(isApprovalStatus("changes_requested")).toBe(true);
    expect(isApprovalStatus("bogus")).toBe(false);
  });

  it("maps each review action to a resulting status with a label", () => {
    expect(REVIEW_ACTIONS.approve).toBe("approved");
    expect(REVIEW_ACTIONS.reject).toBe("rejected");
    expect(REVIEW_ACTIONS.request_changes).toBe("changes_requested");
    for (const status of Object.values(REVIEW_ACTIONS)) {
      expect(APPROVAL_STATUS_LABEL[status]).toBeTruthy();
    }
  });
});
