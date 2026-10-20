import { beforeEach, describe, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({profile:vi.fn(),brain:vi.fn()}));
vi.mock("@/lib/admin",()=>({getSessionProfile:m.profile}));
vi.mock("@/lib/brain",()=>({brainCallReport:m.brain,safeBrainError:()=>"Safe upstream error",fetchBrainKnowledgeScopes:async()=>[]}));
vi.mock("@/lib/ratelimit",()=>({rateLimit:()=>null}));
import { POST } from "@/app/api/call-reports/route";
const request=(body:Record<string,unknown>={})=>new Request("https://chat.test/api/call-reports",{method:"POST",body:JSON.stringify({query:"check calls on 2026-10-20",...body})});
beforeEach(()=>{vi.clearAllMocks();m.profile.mockResolvedValue({userId:"u",role:"admin",permissions:{}});m.brain.mockImplementation(async()=>Response.json({version:"v",content:"report"}));});
describe("live report proxy",()=>{
  it("requires a session and both call-review and transcript access",async()=>{
    m.profile.mockResolvedValueOnce(null);expect((await POST(request())).status).toBe(401);
    m.profile.mockResolvedValueOnce({userId:"u",role:"user",capabilities:["chat.knowledge","chat.call_review","data.document"]});expect((await POST(request())).status).toBe(403);
    m.profile.mockResolvedValueOnce({userId:"u",role:"user",capabilities:["chat.knowledge","data.transcript"]});expect((await POST(request())).status).toBe(403);
    expect(m.brain).not.toHaveBeenCalled();
  });
  it("ignores forged tenant/capability/source fields and forwards only server grants",async()=>{
    const res=await POST(request({orgId:"foreign",capabilities:["forged"],sourceTypes:["secret"],timeZone:"Asia/Karachi"}));expect(res.status).toBe(200);
    const body=m.brain.mock.calls[0][0];expect(body.orgId).toBeUndefined();expect(body.capabilities).not.toContain("forged");expect(body.sourceTypes).toBeUndefined();expect(body.timeZone).toBe("Asia/Karachi");expect(res.headers.get("cache-control")).toContain("no-store");
  });
  it("preserves requested collection narrowing and bounds long polls",async()=>{
    const id="11111111-1111-4111-8111-111111111111";expect((await POST(request({collectionIds:[id],knowledgeScope:"calls",waitMs:20000}))).status).toBe(200);
    expect(m.brain.mock.calls[0][0]).toMatchObject({collectionIds:[id],knowledgeScope:"calls",waitMs:20000});
    expect((await POST(request({waitMs:20001}))).status).toBe(400);expect((await POST(request({query:"a".repeat(8001)}))).status).toBe(400);
  });
  it("sanitizes failures and never persists a chat turn",async()=>{
    m.brain.mockResolvedValueOnce(new Response("private detail",{status:503}));const res=await POST(request());expect(res.status).toBe(503);expect(await res.text()).not.toContain("private detail");
    m.brain.mockRejectedValueOnce(Error("secret"));expect((await POST(request())).status).toBe(503);
  });
});
