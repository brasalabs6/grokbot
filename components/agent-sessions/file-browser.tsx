"use client";
import {useCallback,useEffect,useState} from "react";
import {FileText,Folder,ArrowLeft,RefreshCw,Link2} from "lucide-react";
import {Button} from "@/components/ui/button";
type Entry={name:string;type:"file"|"directory"|"symlink"|"other";size:number;modifiedAt:string};
type Listing={
  ok:boolean;kind?:"directory"|"file";items?:Entry[];content?:string;
  truncated?:boolean;total?:number;error?:{code:string};
};
function child(parent:string,name:string){
  return (parent==="."?"":parent+"/")+name;
}
function parent(path:string){
  const parts=path.split("/").filter(p=>p&&p!==".");
  parts.pop();return parts.join("/")||".";
}
export function FileBrowser({sessionId,active}:{sessionId:string;active:boolean}){
  const [folder,setFolder]=useState(".");
  const [selection,setSelection]=useState<string|null>(null);
  const [listing,setListing]=useState<Listing|null>(null);
  const [opened,setOpened]=useState<Listing|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [revision,setRevision]=useState(0);
  const refresh=useCallback(()=>setRevision(i=>i+1),[]);
  useEffect(()=>{
    if(!active)return;
    const abort=new AbortController();
    setLoading(true);setError(null);
    const url="/api/agent-sessions/"+sessionId+"/files?mode=list&path="+encodeURIComponent(folder);
    void fetch(url,{cache:"no-store",signal:abort.signal}).then(async response=>{
      const data=await response.json() as Listing;
      if(!response.ok||!data.ok)throw new Error(data.error?.code??"LIST_FAILED");
      if(!abort.signal.aborted){setListing(data);setSelection(null);setOpened(null);}
    }).catch(e=>{
      if(!abort.signal.aborted)setError(e instanceof Error?e.message:"WORKSPACE_UNAVAILABLE");
    }).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return ()=>abort.abort();
  },[active,sessionId,folder,revision]);
  async function open(entry:Entry) {
    if(entry.type==="directory"){setFolder(child(folder,entry.name));return;}
    if(entry.type!=="file")return;
    const path=child(folder,entry.name);
    setSelection(path);setOpened(null);setError(null);
    try{
      const url="/api/agent-sessions/"+sessionId+"/files?mode=read&path="+
        encodeURIComponent(path);
      const response=await fetch(url,{cache:"no-store"});
      const result=await response.json() as Listing;
      if(!response.ok||!result.ok)throw new Error(result.error?.code??"FILE_READ_FAILED");
      setOpened(result);
    }catch(e){setError(e instanceof Error?e.message:"FILE_READ_FAILED");}
  }
  if(!active)return <p className="text-sm text-muted-foreground">
    Start the sandbox to browse the workspace.
  </p>;
  return <div className="flex min-h-[360px] flex-1 flex-col gap-3">
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0 truncate font-mono text-xs text-muted-foreground">
        /workspace/{folder==="."?"":folder}
      </div>
      <div className="flex gap-1">
        <Button size="sm" variant="outline" onClick={()=>setFolder(parent(folder))}
          disabled={folder==="."} aria-label="Parent directory"><ArrowLeft className="size-4"/></Button>
        <Button size="sm" variant="outline" onClick={refresh} aria-label="Refresh files">
          <RefreshCw className="size-4"/>
        </Button>
      </div>
    </div>
    {error&&<p role="alert" className="text-sm text-red-500">{error}</p>}
    {loading&&<p className="text-xs text-muted-foreground">Loading workspace…</p>}
    <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[minmax(200px,300px)_minmax(0,1fr)]">
      <nav aria-label="Workspace files" className="max-h-[550px] overflow-auto rounded-md border p-2">
        {listing?.items?.length===0&&<p className="p-3 text-xs text-muted-foreground">Empty directory.</p>}
        {listing?.items?.map(entry=><button key={entry.name} type="button"
          disabled={entry.type==="symlink"||entry.type==="other"}
          onClick={()=>void open(entry)}
          className={"flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted disabled:opacity-50 "+
            (selection===child(folder,entry.name)?"bg-muted":"")}>
          {entry.type==="directory"?<Folder className="size-4 shrink-0"/>:
            entry.type==="symlink"?<Link2 className="size-4 shrink-0"/>:
            <FileText className="size-4 shrink-0"/>}
          <span className="min-w-0 flex-1 truncate">{entry.name}</span>
          {entry.type==="file"&&<span className="text-xs text-muted-foreground">{entry.size}B</span>}
        </button>)}
        {listing?.truncated&&<p className="p-2 text-xs text-amber-500">
          Showing first 200 of {listing.total} entries.
        </p>}
      </nav>
      <section aria-label="File preview" className="min-h-[300px] max-h-[550px] overflow-auto rounded-md border p-3">
        {!selection?<p className="text-sm text-muted-foreground">
          Select a text file to preview its contents.</p>:
          <>
            <h3 className="mb-3 break-all font-mono text-xs text-muted-foreground">{selection}</h3>
            {opened?.content!==undefined?<pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs">{opened.content}</pre>:
              <p className="text-xs text-muted-foreground">Loading file…</p>}
          </>}
      </section>
    </div>
    <p className="text-xs text-muted-foreground">
      Read-only browser. Files are confined to /workspace; large, binary and symlinked files are not previewed.
    </p>
  </div>;
}
