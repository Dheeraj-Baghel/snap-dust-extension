// Playwright is a local development dependency only; the extension needs no build.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { openSync, writeSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(path.join(tmpdir(),'snap-dust-'));
const videoPath=path.join(temp,'camera.y4m');
// Deterministic clean room followed by a colored human-like silhouette.
const w=320,h=240,fd=openSync(videoPath,'w');
writeSync(fd,`YUV4MPEG2 W${w} H${h} F15:1 Ip A1:1 C420jpeg\n`);
function frame(person){const data=Buffer.alloc(w*h*3/2,128);data.fill(70,0,w*h);if(person){for(let y=35;y<225;y++)for(let x=100;x<220;x++){const head=(x-160)**2+(y-70)**2<32**2;const torso=y>100&&x>115&&x<205;if(head||torso)data[y*w+x]=190;}}return data;}
const clean=frame(false),person=frame(true);
for(let i=0;i<900;i++){writeSync(fd,'FRAME\n');writeSync(fd,i<225?clean:person);}closeSync(fd);
// Sharp synthetic high-frequency transient every four seconds, not real snap audio.
const audioPath=path.join(temp,'snap.wav'),rate=48000,pcm=Buffer.alloc(rate*4*2),header=Buffer.alloc(44);
for(let i=0;i<rate*4;i++){const t=i/rate;const pulse=t>2&&t<2.025;pcm.writeInt16LE(pulse?Math.round(Math.sin(2*Math.PI*4000*t)*26000):0,i*2);}
header.write('RIFF');header.writeUInt32LE(36+pcm.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);await writeFile(audioPath,Buffer.concat([header,pcm]));
const html=await readFile(path.join(root,'tests/meeting.html'));
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://localhost:${server.address().port}`;
let context;
const checks=[];
try{
 context=await chromium.launchPersistentContext(path.join(temp,'profile'),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`,'--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-video-capture=${videoPath}`,`--use-file-for-fake-audio-capture=${audioPath}`,'--autoplay-policy=no-user-gesture-required'],viewport:{width:1100,height:820}});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(url);
 // Only the test worker sets the opt-in, equivalent to the popup's origin toggle.
 await worker.evaluate(async origin=>chrome.storage.local.set({[`enabled:${origin}`]:true}),url);
 await page.reload();await page.evaluate(()=>startCamera());
 await page.waitForFunction(()=>!!document.querySelector('#snap-dust-controls'));
 assert.equal(await page.evaluate(()=>meetingStream.getAudioTracks().length),1);checks.push('Original microphone track retained');
 await page.waitForTimeout(500);
 const panel=page.locator('#snap-dust-controls');
 await panel.getByRole('button',{name:'Disappear',exact:true}).click();
 await panel.getByRole('status').filter({hasText:'Capture an empty room'}).waitFor();checks.push('Disappear blocked until clean plate exists');
 const sample=async videoId=>page.evaluate(id=>{const v=document.getElementById(id),c=document.createElement('canvas');c.width=320;c.height=240;const x=c.getContext('2d');x.drawImage(v,0,0,320,240);return [...x.getImageData(160,150,1,1).data];},videoId);
 assert.ok((await sample('local'))[0]<100,'Test must capture an actually empty frame');
 await panel.getByRole('button',{name:'Save empty room'}).click();
 await page.waitForFunction(()=>{const c=document.createElement('canvas');c.width=320;c.height=240;const x=c.getContext('2d');x.drawImage(document.getElementById('local'),0,0,320,240);return x.getImageData(160,150,1,1).data[0]>130;},null,{timeout:25000});
 await page.waitForFunction(()=>document.getElementById('remote').readyState>=2);
 const before=await sample('local');assert.ok(before[0]>130,`Expected silhouette: ${before}`);
 await page.keyboard.press('Alt+Shift+KeyD');await page.waitForTimeout(450);
 await mkdir(path.join(root,'artifacts'),{recursive:true});await page.screenshot({path:path.join(root,'artifacts/dust-midpoint.png')});
 await page.waitForTimeout(3100);
 const gone=await sample('local'),remoteGone=await sample('remote');assert.ok(gone[0]<100,`Expected room: ${gone}`);assert.ok(remoteGone[0]<100,`Remote should receive room: ${remoteGone}`);checks.push('Shortcut dissolves silhouette and remote WebRTC peer receives clean room');
 await page.screenshot({path:path.join(root,'artifacts/disappeared.png')});
 await panel.getByRole('button',{name:'Reappear',exact:true}).click();await page.waitForTimeout(300);assert.ok((await sample('local'))[0]>130);checks.push('Reappear restores live camera');
 await page.screenshot({path:path.join(root,'artifacts/visible.png')});
 await panel.getByRole('button',{name:'Listen for snaps',exact:true}).click();
 await panel.getByRole('button',{name:'Stop listening',exact:true}).waitFor();
 await panel.getByRole('status').filter({hasText:'Turning to dust'}).waitFor({timeout:10000});
 await panel.getByRole('button',{name:'Stop listening',exact:true}).click();
 await page.waitForTimeout(3400);assert.ok((await sample('remote'))[0]<100);checks.push('Opt-in microphone transient detection triggers outgoing disappearance');
 assert.equal(await page.evaluate(()=>meetingStream.getAudioTracks()[0].readyState),'live');checks.push('Stopping snap listener does not stop meeting audio');
 await page.evaluate(()=>stopCamera());await page.waitForFunction(()=>!document.querySelector('#snap-dust-controls'));assert.equal(await page.evaluate(()=>meetingStream.getTracks().every(t=>t.readyState==='ended')),true);checks.push('Meeting stop ends output tracks and removes UI');
 // Verify source release by opening a second session, then stopping.
 await page.evaluate(()=>startCamera());await page.waitForFunction(()=>!!document.querySelector('#snap-dust-controls'));await page.evaluate(()=>stopCamera());await page.waitForFunction(()=>!document.querySelector('#snap-dust-controls'));checks.push('Camera restart succeeds');
 await worker.evaluate(async origin=>chrome.storage.local.set({[`enabled:${origin}`]:false}),url);await page.reload();await page.evaluate(()=>startCamera());assert.equal(await page.locator('#snap-dust-controls').count(),0);assert.ok(await page.evaluate(()=>!meetingStream.getVideoTracks()[0].label.includes('Canvas')));await page.evaluate(()=>stopCamera());checks.push('Disabled origin keeps original webcam and no panel');
 assert.deepEqual(errors,[]);checks.push('No page errors');
 await writeFile(path.join(root,'artifacts/test-results.json'),JSON.stringify({date:new Date().toISOString(),browser:context.browser()?.version(),checks,scope:'Synthetic camera and local WebRTC only; real Meet/Zoom and physical snaps not tested'},null,2));
 console.log(checks.map(c=>'PASS '+c).join('\n'));
}finally{await context?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});}
