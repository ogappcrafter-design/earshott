/**
 * AudioWorklet processors bundled as a Blob URL.
 *
 * earshot-gate     — adaptive downward expander (noise gate)
 * earshot-capture  — record: forwards processed mono audio to main thread
 * earshot-spectral — streaming STFT Wiener-filter noise reduction
 * earshot-ghost    — always-on 45 s ring buffer for Ghost Save
 */
export const WORKLET_SOURCE = `
/* ─── Gate ────────────────────────────────────────────────────────────── */
class EarshotGate extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name:'amount', defaultValue:0.5, minValue:0, maxValue:1, automationRate:'k-rate' }];
  }
  constructor() {
    super();
    this.env=0; this.floor=0.002; this.gain=1;
    this.attack=Math.exp(-1/(0.003*sampleRate));
    this.release=Math.exp(-1/(0.08*sampleRate));
    this.floorUp=Math.exp(-1/(4*sampleRate));
    this.floorDn=Math.exp(-1/(0.4*sampleRate));
  }
  process(inputs,outputs,params){
    const inp=inputs[0],out=outputs[0]; if(!inp||inp.length===0) return true;
    const amount=params.amount[0], n=inp[0].length;
    for(let i=0;i<n;i++){
      let peak=0;
      for(let c=0;c<inp.length;c++) peak=Math.max(peak,Math.abs(inp[c][i]));
      const coef=peak>this.env?this.attack:this.release;
      this.env=coef*this.env+(1-coef)*peak;
      const fc=this.env>this.floor?this.floorUp:this.floorDn;
      this.floor=Math.max(1e-5,fc*this.floor+(1-fc)*this.env);
      const openAt=this.floor*(2+amount*4);
      let target=1;
      if(this.env<openAt){ const r=Math.max(0,this.env/openAt); target=Math.pow(r,1+amount*3); target=Math.max(target,1-amount*0.97); }
      const gc=target<this.gain?0.995:0.9;
      this.gain=gc*this.gain+(1-gc)*target;
      for(let c=0;c<out.length;c++) out[c][i]=(inp[c]||inp[0])[i]*this.gain;
    }
    return true;
  }
}
registerProcessor('earshot-gate', EarshotGate);

/* ─── Capture ──────────────────────────────────────────────────────────── */
class EarshotCapture extends AudioWorkletProcessor {
  constructor(){
    super();
    this.recording=false; this.buf=new Float32Array(4096); this.len=0;
    this.port.onmessage=(e)=>{
      if(e.data==='start'){this.recording=true;this.len=0;}
      if(e.data==='stop'){this.flush();this.recording=false;this.port.postMessage({type:'stopped'});}
    };
  }
  flush(){ if(this.len>0){this.port.postMessage({type:'chunk',data:this.buf.slice(0,this.len)});this.len=0;} }
  process(inputs){
    const inp=inputs[0]; if(!this.recording||!inp||inp.length===0) return true;
    const n=inp[0].length;
    for(let i=0;i<n;i++){
      let s=0; for(let c=0;c<inp.length;c++) s+=inp[c][i];
      this.buf[this.len++]=s/inp.length;
      if(this.len===this.buf.length) this.flush();
    }
    return true;
  }
}
registerProcessor('earshot-capture', EarshotCapture);

/* ─── Spectral Denoiser (STFT Wiener, N=512, hop=128) ─────────────────── */
class EarshotSpectral extends AudioWorkletProcessor {
  constructor(){
    super();
    const N=512; this.N=N; this.hop=N>>2;
    // Hann window
    this.win=new Float32Array(N);
    for(let i=0;i<N;i++) this.win[i]=0.5-0.5*Math.cos(6.2831853*i/N);
    // Bit reversal table
    this.rev=new Uint32Array(N);
    let bits=0; while((1<<bits)<N) bits++;
    for(let i=0;i<N;i++){let x=i,r=0;for(let b=0;b<bits;b++){r=(r<<1)|(x&1);x>>=1;}this.rev[i]=r;}
    // Twiddle factors
    const H=N>>1;
    this.cw=new Float32Array(H); this.sw=new Float32Array(H);
    for(let k=0;k<H;k++){this.cw[k]=Math.cos(-6.2831853*k/N);this.sw[k]=Math.sin(-6.2831853*k/N);}
    // Working buffers
    this.re=new Float32Array(N); this.im=new Float32Array(N);
    this.inBuf=new Float32Array(N); this.outBuf=new Float32Array(N);
    const bins=H+1;
    this.noise=new Float32Array(bins).fill(1e-8);
    this.prevG=new Float32Array(bins).fill(1);
    this.prevP=new Float32Array(bins);
    this.inQ=new Float32Array(this.hop); this.inN=0;
    this.outQ=new Float32Array(N*2); this.outHead=0; this.outTail=0; this.outAvail=0;
    this.framesProcessed=0;
    this.amount=0.5;
    this.bypassed=false;
    this.port.onmessage=(e)=>{
      if(e.data?.type==='amount') this.amount=e.data.value;
      if(e.data?.type==='bypass') this.bypassed=e.data.value;
    };
  }
  _fft(inv){
    const N=this.N,rev=this.rev,re=this.re,im=this.im,cw=this.cw,sw=this.sw;
    for(let i=0;i<N;i++){const j=rev[i];if(j>i){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t;}}
    for(let len=2;len<=N;len<<=1){
      const h=len>>1, step=N/len;
      for(let i=0;i<N;i+=len){
        for(let k=0,idx=0;k<h;k++,idx+=step){
          const wr=cw[idx], wi=inv?-sw[idx]:sw[idx];
          const a=i+k, b=a+h;
          const xr=re[b]*wr-im[b]*wi, xi=re[b]*wi+im[b]*wr;
          re[b]=re[a]-xr; im[b]=im[a]-xi; re[a]+=xr; im[a]+=xi;
        }
      }
    }
    if(inv){const s=1/N;for(let i=0;i<N;i++){re[i]*=s;im[i]*=s;}}
  }
  _doFrame(){
    const N=this.N, H=this.hop, half=N>>1;
    this.inBuf.copyWithin(0,H); this.inBuf.set(this.inQ,N-H);
    for(let n=0;n<N;n++){this.re[n]=this.inBuf[n]*this.win[n]; this.im[n]=0;}
    this._fft(false);
    const over=1+this.amount*4.5;
    const floor=Math.pow(10,(-6-this.amount*22)/20);
    const alpha=0.97;
    for(let k=0;k<=half;k++){
      const power=this.re[k]*this.re[k]+this.im[k]*this.im[k];
      if(power<this.noise[k]) this.noise[k]=0.88*this.noise[k]+0.12*power;
      else this.noise[k]=0.998*this.noise[k]+0.002*power;
      const noiseP=this.noise[k]*over+1e-10;
      const post=power/noiseP;
      const pri=alpha*(this.prevG[k]*this.prevG[k]*this.prevP[k]/noiseP)+(1-alpha)*Math.max(post-1,0);
      let g=Math.max(floor, pri/(pri+1));
      this.prevG[k]=g; this.prevP[k]=power;
      this.re[k]*=g; this.im[k]*=g;
      if(k>0&&k<half){this.re[N-k]=this.re[k]; this.im[N-k]=-this.im[k];}
    }
    this._fft(true);
    const sc=1/1.5;
    for(let n=0;n<N;n++) this.outBuf[n]+=this.re[n]*this.win[n]*sc;
    for(let n=0;n<H;n++){this.outQ[this.outTail]=this.outBuf[n];this.outTail=(this.outTail+1)%this.outQ.length;this.outAvail++;}
    this.outBuf.copyWithin(0,H); this.outBuf.fill(0,N-H);
    this.framesProcessed++;
  }
  process(inputs,outputs){
    const inp=inputs[0]?.[0], out=outputs[0]?.[0];
    if(!inp||!out) return true;
    for(let i=0;i<inp.length;i++){
      this.inQ[this.inN++]=inp[i];
      if(this.inN===this.hop){this._doFrame();this.inN=0;}
      if(this.outAvail>0&&this.framesProcessed>0){
        out[i]=this.bypassed?inp[i]:this.outQ[this.outHead];
        this.outHead=(this.outHead+1)%this.outQ.length; this.outAvail--;
      } else {out[i]=inp[i];}
    }
    return true;
  }
}
registerProcessor('earshot-spectral', EarshotSpectral);

/* ─── Ghost Buffer (always-on 45 s ring) ──────────────────────────────── */
class EarshotGhost extends AudioWorkletProcessor {
  constructor(){
    super();
    this.cap=Math.floor(sampleRate*45);
    this.buf=new Float32Array(this.cap);
    this.ptr=0; this.total=0;
    this.port.onmessage=(e)=>{
      if(e.data?.type==='read'){
        const reqSec=e.data.seconds??30;
        const reqSamples=Math.min(this.cap,Math.floor(reqSec*sampleRate));
        const avail=Math.min(this.total,this.cap);
        const len=Math.min(reqSamples,avail);
        const out=new Float32Array(len);
        if(len>0){
          const start=(this.ptr-len+this.cap)%this.cap;
          if(start+len<=this.cap){ out.set(this.buf.subarray(start,start+len)); }
          else{ const first=this.cap-start; out.set(this.buf.subarray(start),0); out.set(this.buf.subarray(0,len-first),first); }
        }
        this.port.postMessage({type:'audio',data:out,sampleRate});
      }
    };
  }
  process(inputs){
    const inp=inputs[0]?.[0]; if(!inp) return true;
    for(let i=0;i<inp.length;i++){
      this.buf[this.ptr]=inp[i];
      this.ptr=(this.ptr+1)%this.cap;
      this.total++;
    }
    return true;
  }
}
registerProcessor('earshot-ghost', EarshotGhost);
`;
