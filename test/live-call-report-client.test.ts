import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({effect:null as null|(()=>void|(()=>void)),state:null as any}));
vi.mock("react",()=>({useEffect:(fn:()=>void)=>{m.effect=fn;},useState:()=>[m.state,(value:any)=>{m.state=typeof value==="function"?value(m.state):value;}]}));
import { useLiveCallReport } from "@/lib/use-live-call-report";
let cleanup:(()=>void)|void;
let documentEvents:EventTarget;
let windowEvents:EventTarget;
let doc:{visibilityState:string;addEventListener:Function;removeEventListener:Function};
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
function start(){useLiveCallReport("thread:report","check calls on 2026-10-20","Asia/Karachi",{knowledgeScope:"calls"});cleanup=m.effect?.();}
beforeEach(()=>{
  vi.useFakeTimers();m.state=null;documentEvents=new EventTarget();windowEvents=new EventTarget();
  doc={visibilityState:"visible",addEventListener:documentEvents.addEventListener.bind(documentEvents),removeEventListener:documentEvents.removeEventListener.bind(documentEvents)};
  vi.stubGlobal("document",doc);vi.stubGlobal("window",windowEvents);vi.stubGlobal("navigator",{onLine:true});
});
afterEach(()=>{cleanup?.();vi.useRealTimers();vi.unstubAllGlobals();});
describe("automatic live reports",()=>{
  it("keeps one long poll in flight, updates both table and summary, and aborts on unmount",async()=>{
    let secondResolve:(r:Response)=>void=()=>{};
    const fetcher=vi.fn().mockResolvedValueOnce(Response.json({version:"v1",content:"table + summary: Pending",updatedAt:"t1"})).mockImplementationOnce(()=>new Promise<Response>(r=>{secondResolve=r;})).mockImplementation(()=>new Promise(()=>{}));
    vi.stubGlobal("fetch",fetcher);start();await flush();expect(m.state.content).toContain("Pending");
    await vi.advanceTimersByTimeAsync(250);expect(fetcher).toHaveBeenCalledTimes(2);expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({version:"v1",waitMs:20000});
    await vi.advanceTimersByTimeAsync(5000);expect(fetcher).toHaveBeenCalledTimes(2);
    secondResolve(Response.json({version:"v2",content:"table + summary: Closed / High Ticket",updatedAt:"t2"}));await flush();expect(m.state.content).toContain("Closed / High Ticket");
    await vi.advanceTimersByTimeAsync(250);const signal=fetcher.mock.calls[2][1].signal;cleanup?.();cleanup=undefined;expect(signal.aborted).toBe(true);
  });
  it("pauses hidden tabs and checks immediately on return without reload",async()=>{
    const fetcher=vi.fn().mockImplementation(()=>new Promise(()=>{}));vi.stubGlobal("fetch",fetcher);start();
    doc.visibilityState="hidden";documentEvents.dispatchEvent(new Event("visibilitychange"));expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);expect(m.state.state).toBe("paused");
    doc.visibilityState="visible";documentEvents.dispatchEvent(new Event("visibilitychange"));expect(fetcher).toHaveBeenCalledTimes(2);expect(JSON.parse(fetcher.mock.calls[1][1].body).waitMs).toBe(0);
  });
  it("retains last report with an honest stale label and backs off transient errors",async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(Response.json({version:"v1",content:"saved live content"})).mockResolvedValueOnce(new Response(null,{status:503})).mockImplementation(()=>new Promise(()=>{}));vi.stubGlobal("fetch",fetcher);start();await flush();await vi.advanceTimersByTimeAsync(250);await flush();
    expect(m.state).toMatchObject({state:"reconnecting",content:"saved live content"});await vi.advanceTimersByTimeAsync(1999);expect(fetcher).toHaveBeenCalledTimes(2);await vi.advanceTimersByTimeAsync(1);expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("stops unauthorized polling and never invents a fresh report",async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(null,{status:403}));vi.stubGlobal("fetch",fetcher);start();await flush();await vi.advanceTimersByTimeAsync(60000);expect(fetcher).toHaveBeenCalledTimes(1);expect(m.state).toMatchObject({state:"unavailable"});expect(m.state.content).toBeUndefined();
  });
});
