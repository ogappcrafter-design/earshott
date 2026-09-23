import { useCallback, useEffect, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { StoreProvider, useStore } from './state/store';
import { Splash } from './screens/Splash';
import { Onboarding } from './screens/Onboarding';
import { HearingCheck } from './screens/HearingCheck';
import { Listen } from './screens/Listen';
import { Tune } from './screens/Tune';
import { Voices } from './screens/Voices';
import { Archive } from './screens/Archive';
import { Detail } from './screens/Detail';
import { Settings } from './screens/Settings';
import { Toasts, useToasts } from './ui/Controls';
import { Tutorial } from './ui/Tutorial';
import { IconArchive, IconEar, IconGear, IconSliders, IconVoice } from './ui/Icons';
import { sfx } from './ui/sfx';

type Tab = 'listen'|'tune'|'voices'|'archive'|'settings';
const TABS: {id:Tab;label:string;icon:JSX.Element}[] = [
  {id:'listen',  label:'Listen',  icon:<IconEar />},
  {id:'tune',    label:'Tune',    icon:<IconSliders />},
  {id:'voices',  label:'Voices',  icon:<IconVoice />},
  {id:'archive', label:'Archive', icon:<IconArchive />},
  {id:'settings',label:'Settings',icon:<IconGear />},
];

function Shell() {
  const s = useStore();
  const [phase, setPhase] = useState<'splash'|'onboard'|'hearing'|'app'>('splash');
  const [tab, setTab] = useState<Tab>('listen');
  const [openId, setOpenId] = useState<string|null>(null);
  const [showTutorial, setShowTutorial] = useState(false);
  const {items,push} = useToasts();
  const nav = useRef({phase,tab,openId});
  nav.current={phase,tab,openId};

  // Android back gesture
  useEffect(()=>{
    if(!Capacitor.isNativePlatform()) return;
    const sub=CapApp.addListener('backButton',()=>{
      const n=nav.current;
      if(n.phase==='hearing'){setPhase(s.settings.onboarded?'app':'onboard');return;}
      if(n.phase!=='app') return;
      if(n.openId){setOpenId(null);return;}
      if(n.tab!=='listen'){setTab('listen');return;}
      CapApp.minimizeApp();
    });
    return()=>{sub.then((h)=>h.remove());};
  },[s.settings.onboarded]);

  const afterSplash = useCallback(()=>setPhase(s.settings.onboarded?'app':'onboard'),[s.settings.onboarded]);
  const finishHearing = (eq:number[]|null)=>{
    s.setSettings((x)=>eq
      ?{...x,onboarded:true,hearingEq:eq,eqPresetId:'hearing',engine:{...x.engine,eq}}
      :{...x,onboarded:true});
    if(eq) push('Your ear curve is on');
    setPhase('app');
    // Show tutorial on first launch
    if(!s.settings.tutorialSeen){
      setTimeout(()=>setShowTutorial(true), 600);
    }
  };

  // Also trigger tutorial if app was already onboarded but tutorial not seen
  useEffect(()=>{
    if(phase==='app'&&!s.settings.tutorialSeen){
      setTimeout(()=>setShowTutorial(true), 800);
    }
  },[phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTutorialDone = ()=>{
    setShowTutorial(false);
    s.setSettings((x)=>({...x,tutorialSeen:true}));
  };

  let body: JSX.Element;
  if(phase==='splash') body=<Splash onDone={afterSplash} />;
  else if(phase==='onboard') body=<Onboarding onFinish={(run)=>(run?setPhase('hearing'):finishHearing(null))} />;
  else if(phase==='hearing') body=<HearingCheck onDone={finishHearing} onCancel={()=>finishHearing(null)} />;
  else{
    const goHearing=async()=>{if(s.live) await s.stopLive();setPhase('hearing');};
    const screen=openId?<Detail id={openId} onBack={()=>setOpenId(null)} toast={push} />
      :tab==='listen'?<Listen toast={push} />
      :tab==='tune'?<Tune onHearingCheck={goHearing} />
      :tab==='voices'?<Voices toast={push} />
      :tab==='archive'?<Archive onOpen={setOpenId} />
      :<Settings onHearingCheck={goHearing} onReplayIntro={()=>setPhase('splash')}
          onReplayTutorial={()=>setShowTutorial(true)} toast={push} />;
    body=(
      <>
        <main className="main" key={openId??tab}>{screen}</main>
        <nav className="tabbar" aria-label="Main">
          {TABS.map((t)=>(
            <button key={t.id} id={t.id==='archive'?'tour-archive':undefined}
              type="button" className={`tabbar__item${tab===t.id&&!openId?' is-on':''}`}
              aria-current={tab===t.id&&!openId?'page':undefined}
              onClick={()=>{sfx.tap();setOpenId(null);setTab(t.id);}}>
              {t.icon}<span>{t.label}</span>
              {t.id==='listen'&&s.recording&&<i className="tabbar__rec" aria-label="Recording" />}
              {t.id==='listen'&&s.settings.vadEnabled&&!s.recording&&<i className="tabbar__vad" aria-label="Trip Wire" />}
            </button>
          ))}
        </nav>
        {showTutorial&&<Tutorial onDone={handleTutorialDone} />}
      </>
    );
  }
  return <div className="app">{body}<Toasts items={items} /></div>;
}

export default function App() {
  return <StoreProvider><Shell /></StoreProvider>;
}
