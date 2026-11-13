import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { buildPowcatMailAttachment } from "../../src/shared/protocol/powcatMail.mjs";

test("verified linked Boost preview is removed when parent evidence is reorganized", async ({page}) => {
  const txid="a".repeat(64),linker="b".repeat(64),block="c".repeat(64);
  const bytes=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==","base64");
  const fileHash=createHash("sha256").update(bytes).digest("hex");
  const attachment=buildPowcatMailAttachment({txid:linker,fileHash,name:"tiny.png"});
  const post={txid,kind:"boost-post",confirmed:true,authorAddress:"1BoatSLRHtKNngkdXEeobR76b53LETtpyT",text:"A linked image",createdAt:"2026-11-12T00:00:00Z",
    media:{mime:attachment.mime,name:attachment.name,size:attachment.size,sha256:attachment.sha256,source:"same-tx-pwm1-attachment"},
    proofSignalSats:546,proofSignalQ8:"54600000000",totalSignalQ8:"54600000000"};
  let parentConfirmed=true;
  await page.route("**/api/v1/**", route=>{
    if(route.request().method()!=="GET")return route.abort();
    const url=new URL(route.request().url());
    if(url.pathname===`/api/v1/tx/${txid}`)return route.fulfill({json:{txid,network:"livenet",confirmed:parentConfirmed,attachment}});
    if(url.pathname===`/api/v1/powcat/${linker}`){
      if(url.searchParams.has("download"))return route.fulfill({body:bytes,contentType:"application/octet-stream"});
      return route.fulfill({json:{txid:linker,fileHash,network:"livenet",confirmed:true,name:"tiny.png",mime:"image/png",size:bytes.length,
        partTxids:["d".repeat(64)],blockHeight:975600,blockHash:block}});
    }
    return route.fulfill({json:{complete:true,snapshotId:"fixture",network:"livenet",items:url.pathname==="/api/v1/boost"?[post]:[],records:[],listings:[],totalCount:1,hasMore:false,start:0,indexedAt:post.createdAt}});
  });
  await page.goto("/?boost=1");
  await page.getByRole("button",{name:"Open linked file (up to 4 MB)",exact:true}).click();
  await expect(page.locator(".boost-linked-media img")).toBeVisible();
  await expect(page.locator(".boost-linked-media")).toContainText("verified linked file");
  parentConfirmed=false;
  await page.getByRole("button",{name:"Recheck linked file",exact:true}).click();
  await expect(page.locator(".boost-linked-media img")).toHaveCount(0);
  await expect(page.locator(".boost-linked-media")).not.toContainText("verified linked file");
  await expect(page.locator(".boost-linked-media")).toContainText("Confirmed post evidence is unavailable");
  await expect(page.locator(".boost-linked-media").getByRole("button",{name:/Download/})).toHaveCount(0);
});
