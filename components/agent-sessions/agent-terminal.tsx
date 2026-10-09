"use client";

import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { FitAddon as FitAddonType } from "@xterm/addon-fit";

type Ticket = {
  url: string; protocol: string; terminalId: string; generation: number;
  error?: { code?: string };
};

/**
 * Genuine PTY frontend using xterm.js + tmux.
 * A short-lived ticket must be issued for each WebSocket reconnection.
 * ANSI bytes are delivered unchanged: full-screen shell programs work.
 */
export function AgentTerminal({sessionId,active}:{
  sessionId:string;
  active:boolean;
}) {
  const view=useRef<HTMLDivElement>(null);
  const socket=useRef<WebSocket|null>(null);
  const [state,setState]=useState<"connecting"|"connected"|"offline">("offline");
  const [error,setError]=useState<string|null>(null);

  useEffect(()=>{
    if(!active||!view.current)return;
    let disposed=false;
    let retryTimer:ReturnType<typeof setTimeout>|undefined;
    let attempts=0;
    let resizeObserver:ResizeObserver|undefined;
    let terminal:XTerm|undefined;
    let fit:FitAddonType|undefined;
    let removeInput:(()=>void)|undefined;
    const key="grokbot-terminal:"+sessionId;
    let terminalId=sessionStorage.getItem(key);
    if(!terminalId||!/^[0-9a-f-]{36}$/i.test(terminalId)) {
      terminalId=crypto.randomUUID();
      sessionStorage.setItem(key,terminalId);
    }

    const connect=async()=>{
      if(disposed||!terminal)return;
      setState("connecting");
      try {
        const response=await fetch("/api/agent-sessions/"+sessionId+"/terminal-ticket",{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({terminalId}),cache:"no-store"
        });
        const ticket=await response.json() as Ticket;
        if(!response.ok||!ticket.url||!ticket.protocol)
          throw new Error(ticket.error?.code??"TERMINAL_TICKET_FAILED");
        if(disposed)return;
        const url=new URL(ticket.url);
        fit?.fit();
        url.searchParams.set("cols",String(terminal.cols));
        url.searchParams.set("rows",String(terminal.rows));
        const ws=new WebSocket(url.toString(),[ticket.protocol]);
        ws.binaryType="arraybuffer";
        socket.current=ws;
        ws.addEventListener("open",()=>{
          if(disposed){ws.close();return;}
          attempts=0;setState("connected");setError(null);
          terminal?.focus();
          ws.send(JSON.stringify({cols:terminal?.cols??80,rows:terminal?.rows??24}));
        });
        ws.addEventListener("message",evt=>{
          if(disposed||!terminal)return;
          if(evt.data instanceof ArrayBuffer)
            terminal.write(new Uint8Array(evt.data));
          else if(typeof evt.data==="string")
            terminal.write(evt.data);
        });
        ws.addEventListener("close",()=>{
          if(socket.current===ws)socket.current=null;
          if(disposed)return;
          setState("offline");
          terminal?.write("\r\n\x1b[33mConnection lost. Reconnecting…\x1b[0m\r\n");
          attempts=Math.min(attempts+1,6);
          retryTimer=setTimeout(()=>void connect(),Math.min(30_000,1000*2**attempts));
        });
        ws.addEventListener("error",()=>{
          if(!disposed)setError("Terminal WebSocket error");
        });
      }catch(err){
        if(disposed)return;
        setState("offline");
        setError(err instanceof Error?err.message:"TERMINAL_CONNECTION_FAILED");
        attempts=Math.min(attempts+1,6);
        retryTimer=setTimeout(()=>void connect(),Math.min(30_000,1000*2**attempts));
      }
    };

    void (async()=>{
      try{
        const [{Terminal},{FitAddon}]=await Promise.all([
          import("@xterm/xterm"),import("@xterm/addon-fit")
        ]);
        if(disposed||!view.current)return;
        terminal=new Terminal({
          cursorBlink:true,
          convertEol:false,
          scrollback:5000,
          fontFamily:"ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          fontSize:13,
          theme:{background:"#0a0c10",foreground:"#dce3ed",cursor:"#cbd5e1"},
          allowProposedApi:false
        });
        fit=new FitAddon();
        terminal.loadAddon(fit);
        terminal.open(view.current);
        fit.fit();
        const input=terminal.onData(data=>{
          const ws=socket.current;
          if(ws?.readyState===WebSocket.OPEN)
            ws.send(new TextEncoder().encode(data));
        });
        removeInput=()=>input.dispose();
        resizeObserver=new ResizeObserver(()=>{
          try{
            fit?.fit();
            const ws=socket.current;
            if(ws?.readyState===WebSocket.OPEN&&terminal)
              ws.send(JSON.stringify({cols:terminal.cols,rows:terminal.rows}));
          }catch{}
        });
        resizeObserver.observe(view.current);
        terminal.write("\x1b[36mGrokBot Cloudflare PTY · connecting…\x1b[0m\r\n");
        await connect();
      }catch(err){
        if(!disposed)setError(err instanceof Error?err.message:"XTERM_INITIALIZATION_FAILED");
      }
    })();

    return ()=>{
      disposed=true;
      if(retryTimer)clearTimeout(retryTimer);
      resizeObserver?.disconnect();
      removeInput?.();
      socket.current?.close();
      socket.current=null;
      terminal?.dispose();
    };
  },[active,sessionId]);

  if(!active)return <p className="text-sm text-muted-foreground">Sandbox is not running.</p>;
  return <div className="flex min-h-[350px] flex-1 flex-col gap-2">
    <div className="flex items-center justify-between text-xs text-muted-foreground">
      <span>Cloudflare sandbox terminal (PTY/tmux)</span>
      <span aria-live="polite" className={state==="connected"?"text-emerald-500":"text-amber-500"}>
        {state==="connected"?"Connected":state==="connecting"?"Connecting":"Offline"}
      </span>
    </div>
    {error&&<p role="alert" className="text-xs text-red-500">{error}</p>}
    <div ref={view} role="application" aria-label="Interactive sandbox terminal"
      className="min-h-[350px] flex-1 overflow-hidden rounded-md border bg-[#0a0c10] p-2"/>
    <p className="text-xs text-muted-foreground">
      Shell state survives browser reconnection through tmux. Avoid entering secrets in shared sessions.
    </p>
  </div>;
}
