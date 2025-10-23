/* KQuiz Addon: Mini Start Sounds (v1)
 * Triggers on mini start:
 *  - Map overlay mount:   #kq-map-overlay
 *  - Money overlay mount: #kq-money-overlay
 *  - Solo overlay mount:  .kq-solo-overlay
 *
 * Audio sources (override if needed):
 *   KQuiz.state.settings.sounds.miniStart = {
 *     mapUrl:   "…",
 *     moneyUrl: "…",
 *     soloUrl:  "…",
 *     volume:   0.25
 *   }
 * Or window.KQ_MINI_START_URLS = { mapUrl, moneyUrl, soloUrl, volume }
 */
(function(){
  "use strict";
  function factory(){
    const ID = "miniStartSounds";
    const SEL = {
      map:   "#kq-map-overlay",
      money: "#kq-money-overlay",
      solo:  ".kq-solo-overlay"
    };

    // state
    const aud = { map:null, money:null, solo:null };
    let unlocked = false;
    let bodyMO = null;
    const playedThisMount = new WeakSet(); // overlay nodes we already reacted to

    // utils
    const dbg = (...a)=>{ if(window.KQ_WARN10_DEBUG) console.log("[%s]", ID, ...a); };

    function scriptBase(){
      const s = [...document.scripts].reverse().find(x=>/mini-start-sounds/i.test(x.src)) || document.currentScript;
      return s && s.src ? s.src.slice(0, s.src.lastIndexOf("/")+1) : "/kquiz/addons/";
    }

    function resolveConfig(K){
      const base = scriptBase();
      const pickAudio = (name) => {
        try {
          if (window.KQ_ASSETS?.audio) return window.KQ_ASSETS.audio(name);
        } catch {}
        const fallbackBase = base.endsWith("addons/")
          ? base.replace(/addons\/$/i, "assets/audio/")
          : base;
        return fallbackBase + name;
      };
      const cfgFromState = K?.state?.settings?.sounds?.miniStart || {};
      const cfgFromGlobal = window.KQ_MINI_START_URLS || {};
      const volume = (typeof cfgFromState.volume === "number")
        ? cfgFromState.volume
        : (typeof cfgFromGlobal.volume === "number" ? cfgFromGlobal.volume : 0.25);

      return {
        mapUrl:   cfgFromState.mapUrl   || cfgFromGlobal.mapUrl   || pickAudio("map-start.mp3"),
        moneyUrl: cfgFromState.moneyUrl || cfgFromGlobal.moneyUrl || pickAudio("money-start.mp3"),
        soloUrl:  cfgFromState.soloUrl  || cfgFromGlobal.soloUrl  || pickAudio("solo-start.mp3"),
        volume:   Math.max(0, Math.min(1, volume))
      };
    }

    function mkAudio(src, vol, id){
      const a = document.createElement("audio");
      a.preload = "auto";
      a.src = src;
      a.volume = vol;
      a.muted = false;
      a.id = id;
      a.style.display = "none";
      document.body.appendChild(a);
      return a;
    }

    function ensureAudio(K){
      const cfg = resolveConfig(K);
      if(!aud.map)   aud.map   = mkAudio(cfg.mapUrl,   cfg.volume, "kq-mini-audio-map");
      if(!aud.money) aud.money = mkAudio(cfg.moneyUrl, cfg.volume, "kq-mini-audio-money");
      if(!aud.solo)  aud.solo  = mkAudio(cfg.soloUrl,  cfg.volume, "kq-mini-audio-solo");

      // unlock once per session to satisfy autoplay policies
      const unlock = async () => {
        if(unlocked) return;
        try {
          await aud.map.play();   aud.map.pause();   aud.map.currentTime = 0;
          await aud.money.play(); aud.money.pause(); aud.money.currentTime = 0;
          await aud.solo.play();  aud.solo.pause();  aud.solo.currentTime = 0;
          unlocked = true; dbg("audio unlocked");
        } catch(_) { /* will retry on next gesture */ }
      };
      ["pointerdown","touchstart","keydown"].forEach(ev=>window.addEventListener(ev, unlock, {capture:true}));
    }

    function play(kind){
      try {
        const a = aud[kind];
        if(!a) return;
        a.currentTime = 0;
        a.play();
        dbg("play", kind);
      } catch(e) { dbg("play failed", kind, e); }
    }

    function tryDetectAndPlay(){
      // MAP
      document.querySelectorAll(SEL.map).forEach(el=>{
        if(!playedThisMount.has(el)){ playedThisMount.add(el); play("map"); }
      });
      // MONEY
      document.querySelectorAll(SEL.money).forEach(el=>{
        if(!playedThisMount.has(el)){ playedThisMount.add(el); play("money"); }
      });
      // SOLO
      document.querySelectorAll(SEL.solo).forEach(el=>{
        if(!playedThisMount.has(el)){ playedThisMount.add(el); play("solo"); }
      });
    }

    function enable(K){
      ensureAudio(K);

      // react to overlays being added
      if(bodyMO) try{ bodyMO.disconnect(); }catch{}
      bodyMO = new MutationObserver(tryDetectAndPlay);
      bodyMO.observe(document.body, { childList:true, subtree:true });

      // fire immediately if already mounted
      tryDetectAndPlay();

      // also listen to bus if available
      try{
        if(K.on){
          K.on("miniGameStart", (ev)=>{
            const t = (ev && (ev.id||ev.type||ev.name)||"").toLowerCase();
            if(/map/.test(t))   play("map");
            else if(/money|pinig/.test(t)) play("money");
            else if(/solo|milestone/.test(t)) play("solo");
          });
        }
      }catch{}

      dbg("enabled");
    }

    function disable(){
      try{ bodyMO && bodyMO.disconnect(); }catch{}
      bodyMO = null;
    }

    return {
      id: ID,
      name: "Mini Start Sounds",
      description: "Plays distinct start sounds for Map, Money, and Solo. Volume=0.25 by default.",
      defaultEnabled: true,
      enable, disable
    };
  }

  function register(){
    if(!window.KQuiz || !KQuiz.registerAddon) return setTimeout(register, 120);
    KQuiz.registerAddon(factory());
  }
  register();
})();
