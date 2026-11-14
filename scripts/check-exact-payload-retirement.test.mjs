import test from "node:test";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";

// These are isolated component tests, not a completed production retirement or
// the separate full installed-runtime authority integration fixture.
for(const name of ["receipt","context","controller","policy","transition","operator"]) {
 const rootOnly=["controller","policy","transition"].includes(name);
 test("isolated exact-payload retirement component: "+name,{skip:rootOnly&&process.getuid?.()!==0?"Root-owned protected-filesystem fixture requires isolated root qualification":false},()=>{
  const path=fileURLToPath(new URL("../deploy/ui-retention/check-retirement-"+name+".test.py",import.meta.url));
  execFileSync("/usr/bin/python3",["-I","-B",path],{
   encoding:"utf8",stdio:["ignore","pipe","pipe"],timeout:60000,maxBuffer:2*1024**2,
   env:{PATH:"/usr/bin:/bin",HOME:"/nonexistent",LC_ALL:"C",PYTHONDONTWRITEBYTECODE:"1"},
  });
 });
}
