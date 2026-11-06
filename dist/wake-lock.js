'use strict';
// Keep the visible practice station awake without interfering with manual locking.
class PracticeWakeLock {
  constructor(onChange, nav=navigator, doc=document) {
    this.nav=nav;this.doc=doc;this.onChange=onChange;
    this.active=false;this.lock=null;this.pending=null;this.version=0;
    doc.addEventListener('visibilitychange',()=>{
      if(doc.hidden){this.version++;this.release();this.report(this.active?'waiting':'idle');}
      else if(this.active)this.acquire();
    });
    this.report('idle');
  }
  get supported(){return typeof this.nav.wakeLock?.request==='function';}
  report(state){this.onChange(state,this.supported);}
  setActive(active) {
    if(this.active!==active){this.active=active;this.version++;}
    if(active)return this.acquire();
    this.release();this.report('idle');
    return Promise.resolve();
  }
  release() {
    const lock=this.lock;this.lock=null;
    if(lock)Promise.resolve(lock.release()).catch(()=>{});
  }
  async acquire() {
    if(!this.active||this.doc.hidden||this.pending||this.lock&&!this.lock.released)return;
    if(!this.supported){this.report('unsupported');return;}
    const version=this.version;
    this.report('requesting');
    const request=(async()=>{
      try {
        const lock=await this.nav.wakeLock.request('screen');
        if(!this.active||this.doc.hidden||version!==this.version){await lock.release();return;}
        this.lock=lock;
        lock.addEventListener('release',()=>{
          if(this.lock!==lock)return;
          this.lock=null;this.report(this.active?'released':'idle');
        });
        if(lock.released){this.lock=null;this.report('released');}
        else this.report('locked');
      }catch(error){if(this.active&&version===this.version&&!this.doc.hidden)this.report('blocked');}
    })();
    this.pending=request;
    await request;
    if(this.pending===request)this.pending=null;
    // A stop/start or visibility transition during a pending request needs a fresh lock.
    if(this.active&&!this.doc.hidden&&version!==this.version)return this.acquire();
  }
}
window.PracticeWakeLock=PracticeWakeLock;
