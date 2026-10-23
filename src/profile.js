export const PROFILE_URL = '/photos/hammer-profile.webp';
export function createProfile() {
  const dialog = document.createElement('dialog'); dialog.className = 'profile-dialog';
  dialog.setAttribute('aria-label', '李四川 Hammer Lee 人物資料');
  dialog.innerHTML = `<div class="profile-cover"><img src="${PROFILE_URL}" alt="李四川官方形象照"/><button class="round-button profile-close" aria-label="關閉人物資料">×</button></div><button class="profile-portrait" aria-label="放大李四川頭貼"><img src="${PROFILE_URL}" alt="李四川頭貼"/></button><h2>李四川－川伯</h2><p class="profile-alias">Hammer Lee</p><p>做事的人，做成事的人</p><div class="profile-links"><button class="secondary-button profile-return"><span aria-hidden="true">←</span>回對話</button><a href="https://www.facebook.com/profile.php?id=100051818071280" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">f</span>官方粉專</a><a href="https://portaly.cc/hammerlee" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">↗</span>官網</a></div><p class="profile-note">預先編寫的未來新北市政資訊展示。<br>雙方對話皆為預寫，非本人即時回覆或原話。</p>`;
  const lightbox = document.createElement('dialog'); lightbox.className='photo-dialog'; lightbox.setAttribute('aria-label','放大頭貼');
  lightbox.innerHTML=`<button class="round-button photo-close" aria-label="關閉放大照片">×</button><img src="${PROFILE_URL}" alt="李四川完整形象照"/><a class="primary-button photo-download" href="${PROFILE_URL}" download="李四川-Hammer-Lee.webp">下載照片 ↓</a>`;
  document.body.append(dialog,lightbox);
  for (const selector of ['.profile-close','.profile-return']) dialog.querySelector(selector).onclick=()=>dialog.close();
  dialog.querySelector('.profile-portrait').onclick=()=>lightbox.showModal();
  lightbox.querySelector('.photo-close').onclick=()=>lightbox.close();
  for (const d of [dialog,lightbox]) d.addEventListener('click', e=>{ if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}});
  return {open:()=>dialog.showModal(),close:()=>dialog.close(),destroy:()=>{dialog.remove();lightbox.remove();}};
}
