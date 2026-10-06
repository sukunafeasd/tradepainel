import {createIcon} from './icons.js';

const tools={openSettings:'Settings',closeSettings:'X',chartOlder:'RotateCcw',chartZoomIn:'Plus',chartZoomOut:'Minus',chartHorizontal:'Minus',chartTrend:'TrendingUp',chartClear:'BrushCleaning',chartReset:'RotateCcw'};
for(const [id,name] of Object.entries(tools)){
  const button=document.getElementById(id);
  if(!button)continue;
  const label=button.getAttribute('aria-label')||button.title||button.textContent.trim();
  button.setAttribute('aria-label',label);
  button.replaceChildren(createIcon(name,18));
}
const follow=document.getElementById('chartFollow');
if(follow)follow.replaceChildren(createIcon('Activity',16),document.createTextNode('Ao vivo'));
const search=document.querySelector('.search span');
if(search)search.replaceChildren(createIcon('Search',18));

const modal=document.getElementById('settingsModal');
const backgrounds=[document.querySelector('.topbar'),document.querySelector('.shell')];
const sync=()=>{const open=modal.classList.contains('open');for(const element of backgrounds)if(element)element.inert=open;document.getElementById('openSettings').setAttribute('aria-expanded',String(open));};
new MutationObserver(sync).observe(modal,{attributes:true,attributeFilter:['class']});
document.addEventListener('keydown',event=>{
  if(event.key!=='Tab'||!modal.classList.contains('open'))return;
  const controls=[...modal.querySelectorAll('button,input,select,a[href]')].filter(element=>!element.disabled&&element.offsetParent!==null);
  const first=controls[0],last=controls.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
});
