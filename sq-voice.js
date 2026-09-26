// ── CONFETTI ──────────────────────────────────────────────────────────────────
(function(){
  const COLORS=['#3B7BE8','#FFD700','#FFF0A0','#1F5FD1','#ffffff','#174BAA','#ffe066'];
  let particles=[], raf=null, canvas, ctx, running=false;

  function initCanvas(){
    canvas=document.getElementById('confettiCanvas');
    ctx=canvas.getContext('2d');
  }

  function resize(){
    canvas.width=window.innerWidth;
    canvas.height=window.innerHeight;
  }

  function spawn(count){
    for(let i=0;i<count;i++){
      const col=COLORS[Math.floor(Math.random()*COLORS.length)];
      particles.push({
        x: Math.random()*window.innerWidth,
        y: -20 - Math.random()*200,
        w: 6+Math.random()*8,
        h: 3+Math.random()*5,
        r: Math.random()*Math.PI*2,
        vx: (Math.random()-0.5)*3,
        vy: 2+Math.random()*4,
        vr: (Math.random()-0.5)*0.15,
        color: col,
        alpha: 0.8+Math.random()*0.2,
        shimmer: Math.random()*Math.PI*2,
        shimmerSpeed: 0.05+Math.random()*0.08,
        life: 1.0,
        decay: 0.004+Math.random()*0.003
      });
    }
  }

  function frame(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    let alive=false;
    for(const p of particles){
      p.x+=p.vx; p.y+=p.vy; p.r+=p.vr;
      p.shimmer+=p.shimmerSpeed;
      p.vy+=0.06; // gravity
      p.vx*=0.995;
      if(p.y<canvas.height+30) alive=true;
      const shimAlpha=p.alpha*(0.7+0.3*Math.sin(p.shimmer));
      ctx.save();
      ctx.globalAlpha=shimAlpha;
      ctx.translate(p.x,p.y);
      ctx.rotate(p.r);
      ctx.fillStyle=p.color;
      ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);
      // shimmer highlight
      ctx.fillStyle='rgba(255,255,255,0.6)';
      ctx.fillRect(-p.w/2,-p.h/2,p.w*0.3,p.h);
      ctx.restore();
    }
    particles=particles.filter(p=>p.y<canvas.height+40);
    if(particles.length>0||alive){ raf=requestAnimationFrame(frame); }
    else{ running=false; canvas.hidden=true; }
  }

  window.triggerConfetti=function(){
    if(!canvas) initCanvas();
    canvas.hidden=false;
    resize();
    spawn(160);
    // spawn a second wave
    setTimeout(()=>spawn(100),300);
    if(!running){ running=true; raf=requestAnimationFrame(frame); }
  };

  window.addEventListener('resize',()=>{ if(!canvas||canvas.hidden) return; resize(); });

  document.addEventListener('DOMContentLoaded',()=>{
    const logo=document.getElementById('navLogo');
    if(logo) logo.addEventListener('mouseenter',window.triggerConfetti);
  });
})();

// ── VOICE DEMO — live OpenAI voice over WebRTC (gpt-live-1, fallback gpt-realtime-2.1) ──
let rtc=null, rtcDc=null, rtcMic=null, rtcAudio=null, rtcEngine=null, rtcMuted=false, rtcConnecting=false;
let liveAlexLine=null, liveUserLine=null, rtcQueue=[];

function vStatus(t){ const el=document.getElementById('voiceStatus'); if(el) el.textContent=t||''; }
function escHtml(t){ return String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function addLine(speaker, text, color){
  const div=document.createElement('div');
  div.style.marginBottom='8px';
  div.innerHTML=`<span style="color:${color||'rgba(255,255,255,0.5)'};font-weight:600;">${speaker}:</span> <span class="t">${escHtml(text)}</span>`;
  document.getElementById('transcriptLines').appendChild(div);
  document.getElementById('voiceTranscript').scrollTop=9999;
  return div;
}
function appendTo(line, delta){
  const t=line.querySelector('.t'); t.textContent+=delta;
  document.getElementById('voiceTranscript').scrollTop=9999;
}
function alexDelta(delta){
  if(!delta) return;
  liveUserLine=null;
  if(!liveAlexLine) liveAlexLine=addLine('Ace','', 'var(--signal)');
  appendTo(liveAlexLine, delta);
}
function userDelta(delta){
  if(!delta) return;
  liveAlexLine=null;
  if(!liveUserLine) liveUserLine=addLine('You','', 'rgba(255,255,255,0.8)');
  appendTo(liveUserLine, delta);
}

function setMicBtn(){
  const btn=document.getElementById('voiceMicBtn'); if(!btn) return;
  if(rtcConnecting){ btn.textContent='Connecting…'; btn.style.background='transparent'; return; }
  if(!rtc){ btn.textContent='🎙 Start Talking'; btn.style.background='transparent'; return; }
  if(!rtcMic){ btn.textContent='🎙 Enable Mic'; btn.style.background='transparent'; return; }
  btn.textContent=rtcMuted?'🔇 Muted — tap to talk':'🔴 Live — tap to mute';
  btn.style.background=rtcMuted?'transparent':'rgba(255,50,50,0.15)';
}

function rtcSend(evt){
  if(rtcDc && rtcDc.readyState==='open') rtcDc.send(JSON.stringify(evt));
  else rtcQueue.push(evt);
}

function handleRtcEvent(e){
  let ev; try{ ev=JSON.parse(e.data); }catch(_){ return; }
  switch(ev.type){
    // gpt-live-1
    case 'session.started': vStatus('Connected · speak any time'); break;
    case 'session.output_transcript.delta': alexDelta(ev.delta); break;
    case 'session.input_transcript.delta': userDelta(ev.delta); break;
    // gpt-realtime
    case 'session.created': vStatus('Connected · speak any time'); rtcSend({type:'response.create'}); break;
    case 'response.output_audio_transcript.delta': alexDelta(ev.delta); break;
    case 'response.output_audio_transcript.done': liveAlexLine=null; break;
    case 'conversation.item.input_audio_transcription.completed':
      if(ev.transcript && ev.transcript.trim()){ liveAlexLine=null; liveUserLine=null; addLine('You',ev.transcript.trim(),'rgba(255,255,255,0.8)'); }
      break;
    case 'input_audio_buffer.speech_started': liveAlexLine=null; break;
    case 'error': console.error('[voice]',ev); vStatus('Voice error: '+((ev.error&&ev.error.message)||'unknown')); break;
  }
}

async function startLive(){
  if(rtc||rtcConnecting) return;
  rtcConnecting=true; setMicBtn(); vStatus('Connecting to Ace…');
  try{
    const pc=new RTCPeerConnection();
    rtc=pc;
    rtcAudio=document.getElementById('alexAudio')||Object.assign(document.createElement('audio'),{id:'alexAudio',autoplay:true});
    if(!rtcAudio.isConnected){ rtcAudio.style.display='none'; document.body.appendChild(rtcAudio); }
    pc.ontrack=ev=>{ rtcAudio.srcObject=ev.streams[0]; rtcAudio.play().catch(()=>{}); };
    pc.onconnectionstatechange=()=>{ if(['failed','closed'].includes(pc.connectionState) && rtc===pc){ vStatus('Connection closed.'); stopLive(); } };
    try{
      rtcMic=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      rtcMic.getTracks().forEach(t=>pc.addTrack(t,rtcMic));
    }catch(err){
      rtcMic=null;
      pc.addTransceiver('audio',{direction:'recvonly'});
      document.getElementById('typeInput').style.display='flex';
    }
    const dc=pc.createDataChannel('oai-events');
    rtcDc=dc;
    dc.onmessage=handleRtcEvent;
    dc.onopen=()=>{ const q=rtcQueue; rtcQueue=[]; q.forEach(rtcSend); };
    const offer=await pc.createOffer();
    await pc.setLocalDescription(offer);
    const r=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sdp:offer.sdp})});
    const data=await r.json().catch(()=>({}));
    if(!r.ok||!data.sdp) throw new Error((data&&data.error)||('HTTP '+r.status));
    if(rtc!==pc) return;
    rtcEngine=data.engine;
    await pc.setRemoteDescription({type:'answer',sdp:data.sdp});
    const tag=document.getElementById('voiceEngineTag'); if(tag) tag.textContent='Live · OpenAI '+(data.model||'');
    vStatus(rtcMic?'Connected · speak any time':'Mic unavailable · type below and Ace will answer out loud');
  }catch(err){
    console.error('[voice] start failed',err);
    vStatus('Could not connect to the live agent. Please try again.');
    stopLive();
  }finally{
    rtcConnecting=false; setMicBtn();
  }
}

function stopLive(){
  try{ if(rtcDc) rtcDc.close(); }catch(_){}
  try{ if(rtc) rtc.close(); }catch(_){}
  if(rtcMic) rtcMic.getTracks().forEach(t=>t.stop());
  if(rtcAudio) rtcAudio.srcObject=null;
  rtc=null; rtcDc=null; rtcMic=null; rtcEngine=null; rtcMuted=false; rtcQueue=[];
  liveAlexLine=null; liveUserLine=null;
  setMicBtn();
}

function toggleMic(){
  if(!rtc){ startLive(); return; }
  if(!rtcMic){ stopLive(); startLive(); return; }
  rtcMuted=!rtcMuted;
  rtcMic.getAudioTracks().forEach(t=>t.enabled=!rtcMuted);
  setMicBtn();
}

function alexSpeak(){
  const ti=document.getElementById('typeInput');
  ti.style.display=ti.style.display==='flex'?'none':'flex';
  if(ti.style.display==='flex') setTimeout(()=>document.getElementById('msgInput').focus(),50);
}

function sendTyped(){
  const inp=document.getElementById('msgInput');
  const text=inp.value.trim();
  if(!text) return;
  inp.value='';
  liveAlexLine=null; liveUserLine=null;
  addLine('You',text,'rgba(255,255,255,0.8)');
  if(!rtc) startLive();
  const send=()=>{
    if(rtcEngine==='realtime'){
      rtcSend({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text}]}});
      rtcSend({type:'response.create'});
    }else{
      rtcSend({type:'response.item.create',item:{type:'message',role:'user',content:[{type:'text',text}]}});
    }
  };
  if(rtcEngine) send();
  else { const iv=setInterval(()=>{ if(rtcEngine){clearInterval(iv);send();} else if(!rtc&&!rtcConnecting){clearInterval(iv);} },150); }
}

function openVoiceDemo(e){
  if(e) e.preventDefault();
  if(window.speechSynthesis) window.speechSynthesis.cancel();
  stopVoice();
  document.getElementById('transcriptLines').innerHTML='';
  document.getElementById('voiceModal').style.display='flex';
  startLive();
}

function closeVoiceDemo(){
  stopLive();
  document.getElementById('voiceModal').style.display='none';
  vStatus('');
}

document.addEventListener('keydown',e=>{
  if(e.key==='Escape') closeVoiceDemo();
});

// ROI Calculator
function fmt(n){return n>=1000?'$'+Math.round(n).toLocaleString():'$'+Math.round(n);}
function calcROI(){
  const calls=+document.getElementById('roiCalls').value;
  const dur=+document.getElementById('roiDuration').value;
  const rate=+document.getElementById('roiRate').value;
  const hrs=calls*dur/60;
  const humanCost=hrs*rate;
  // Squadron: ~$0.04/min voice + $99 base
  const sqCost=Math.max(99,calls*dur*0.04+99);
  const saving=Math.max(0,humanCost-sqCost);
  const pct=humanCost>0?Math.round(saving/humanCost*100):0;
  document.getElementById('roiCallsVal').textContent=calls.toLocaleString();
  document.getElementById('roiDurationVal').textContent=dur+' min';
  document.getElementById('roiRateVal').textContent='$'+rate+'/hr';
  document.getElementById('roiSaving').textContent=fmt(saving);
  document.getElementById('roiHumanCost').textContent=fmt(humanCost);
  document.getElementById('roiSquadCost').textContent=fmt(sqCost);
  document.getElementById('roiPercent').textContent=pct+'%';
}
window.addEventListener('load',calcROI);

// CTA email capture
function ctaSubmit(e){
  e.preventDefault();
  const email=document.getElementById('ctaEmail').value;
  // Store locally and redirect
  try{localStorage.setItem('squadronEmail',email);}catch(ex){}
  window.location.href='/deploy?email='+encodeURIComponent(email);
}
