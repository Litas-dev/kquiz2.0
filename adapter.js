<!-- in public/kquiz/index.html, after your scripts -->
<script>
(function(){
  const K = window.KQuiz;
  const ioClient = window.io();                  // default namespace
  const seen = new Set();

  function lc(v){ return v==null ? "" : String(v).toLowerCase(); }
  function canonId(m){
    // prefer secUid → uniqueId → userId; fallback to anon
    const sec = m.user?.secUid || m.secUid || "";
    const unq = m.user?.uniqueId || m.uniqueId || "";
    const uid = m.userId || m.user?.userId || "";
    return lc(sec || unq || uid || `anon:${lc(m.nickname||m.displayName||"")}`);
  }
  function pickName(m){
    return m.displayName || m.nickname || m.user?.uniqueId || m.uniqueId || "Žaidėjas";
  }
  function pickAvatar(m){
    return m.profilePictureUrl || m.user?.profilePictureUrl || m.avatarThumb || m.avatar || "";
  }

  // Chat-Reader emits chat frames over Socket.IO; names are stable in the demo. :contentReference[oaicite:3]{index=3}
  ioClient.on('connect', ()=> console.log('[kquiz] sio connected'));
  ioClient.on('disconnect', ()=> console.log('[kquiz] sio disconnected'));

  // Be liberal: accept both 'chat' and 'tiktok:chat' shapes.
  const handlers = ['chat','tiktok:chat'];
  handlers.forEach(evt=>{
    ioClient.on(evt, (m)=>{
      const text = String(m.comment || m.text || '');
      if (!text) return;
      const id = canonId(m);
      const name = pickName(m);
      const avatar = pickAvatar(m);
      const msgId = m.msgId || m.eventId || `${id}|${text}|${Math.floor((m.timestamp||Date.now())/1000)}`;
      if (seen.has(msgId)) return; seen.add(msgId);

      K.emit('wsMessage', {
        type:'chat',
        userId:id,
        user:{ userId:id, secUid:m.secUid||m.user?.secUid||null, uniqueId:m.uniqueId||m.user?.uniqueId||null, nickname:name, profilePictureUrl:avatar },
        displayName:name,
        profilePicture:avatar,
        profilePictureUrl:avatar,
        text,
        timestamp: m.timestamp || Date.now(),
        msgId
      });
    });
  });
})();
</script>
