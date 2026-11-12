import { describe, it, expect } from "vitest";
import { savedCallReportQuery, callReportHistory } from "@/lib/saved-call-report";
const thread = (content: string, createdAt: unknown = "2026-10-19T21:29:00Z") => [{ role: "user", content, createdAt }, { role: "assistant", content: "There are zero calls. Consultant-wise Summary" }];
describe("saved report refresh", () => {
  it("refreshes client closing reports even when the request never says calls",()=>{
    const query="Give me names of clients closed on HT For the month of November";
    expect(savedCallReportQuery(thread(query),1)).toBe(query);
    expect(savedCallReportQuery([{role:"user",content:query},{role:"assistant",content:"I can't verify any November High Ticket closings from the supplied records."}],1)).toBe(query);
  });
  it("preserves the user-filter context of a short clarification, without treating assistant guesses as filters",()=>{
    const messages=[{role:"user",content:"number of 10 nov calls",createdAt:"2026-11-09T22:17:00Z"},{role:"assistant",content:"Do you mean LT or all calls?"},{role:"user",content:"yes all calls",createdAt:"2026-11-09T22:20:00Z"},{role:"assistant",content:"Total calls cannot be verified"}];
    expect(savedCallReportQuery(messages,3)).toBe("yes all calls");expect(callReportHistory(messages,3)).toHaveLength(2);expect(callReportHistory(messages,3).every(m=>m.role === "user")).toBe(true);
  });
  it.each(["What is the total of LT calls from 1 to 11 November 2026 across all consultants?","count high ticket closings this month","how many pending calls on 2026-11-10"])("refreshes aggregate reports through the same live path: %s",query=>{
    expect(savedCallReportQuery(thread(query),1)).toBe(query);
  });
  it("preserves the screenshot's original Karachi date despite later refreshes", () => {
    expect(savedCallReportQuery(thread("check yesterdaycalls"), 1, "Asia/Karachi")).toBe("check 2026-10-19 calls");
    expect(savedCallReportQuery(thread("check yesterday's calls"), 1, "America/New_York")).toBe("check 2026-10-18 calls");
  });
  it("keeps explicit filters and does not re-interpret old relative dates without a timestamp", () => {
    expect(savedCallReportQuery(thread("give me James calls on 2026-10-19"), 1)).toBe("give me James calls on 2026-10-19");
    expect(savedCallReportQuery(thread("check yesterdaycalls", null), 1)).toBeNull();
    expect(savedCallReportQuery(thread("write a post about yesterday calls"), 1)).toBeNull();
  });
});
