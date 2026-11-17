"use client";
import {useEffect,useState} from "react";
/** Elapsed time is observation, never a fabricated completion percentage. */
export function AnswerProgress({label}:{label:string|null}) {
 const [seconds,setSeconds]=useState(0);
 useEffect(()=>{const start=Date.now();const timer=setInterval(()=>setSeconds(Math.floor((Date.now()-start)/1000)),1000);return()=>clearInterval(timer);},[]);
 return <div className="space-y-1 text-sm text-muted-foreground">
  <p role="status" aria-live="polite">{label??"Waiting for the Brain to respond"}</p>
  <p className="text-xs"><span aria-live="off">{seconds}s elapsed.</span> {seconds>=15?"Still waiting for a complete response. You can stop this request below.":"Your question will stay here if the request is interrupted."}</p>
 </div>;
}
