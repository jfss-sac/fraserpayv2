export const WALLET_REFRESH_SCRIPT = `(function(){
var fmt=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Toronto",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
function money(c){var s=c<0?"-":"";c=Math.abs(c);return s+"$"+Math.floor(c/100)+"."+String(c%100).padStart(2,"0");}
function q(s){return document.querySelector(s);}
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e;}
function title(e){
if(e.type==="purchase")return e.boothName||"Purchase";
if(e.type==="refund")return e.boothName?"Refund · "+e.boothName:"Refund";
if(e.type==="topup")return e.method?"Top-up · "+(e.method==="cash"?"Cash":"Card"):"Top-up";
return "Adjustment";
}
function row(e){
var li=el("li","flex flex-col gap-1 py-3");
var head=el("div","flex items-baseline justify-between gap-4");
head.appendChild(el("span","font-medium text-foreground",title(e)));
var cr=e.direction==="credit";
head.appendChild(el("span",cr?"font-semibold text-success":"font-semibold text-foreground",(cr?"+":"")+money(cr?e.amountCents:-e.amountCents)));
li.appendChild(head);
if(e.lineItems&&e.lineItems.length){
var ul=el("ul","flex flex-col gap-0.5 text-sm text-muted");
e.lineItems.forEach(function(l){
var r=el("li","flex justify-between gap-4");
r.appendChild(el("span",null,l.name+" × "+l.qty+" @ "+money(l.unitPriceCents)));
r.appendChild(el("span",null,money(l.qty*l.unitPriceCents)));
ul.appendChild(r);
});
li.appendChild(ul);
}
if(e.reason)li.appendChild(el("p","text-sm text-muted",e.reason));
var foot=el("div","flex items-baseline justify-between gap-4 text-xs text-muted");
var t=el("time",null,fmt.format(new Date(e.createdAt)));
t.setAttribute("datetime",e.createdAt);
foot.appendChild(t);
foot.appendChild(el("span",null,"Balance "+money(e.balanceAfterCents)));
li.appendChild(foot);
return li;
}
function stale(on){var s=q("[data-wallet-stamp]");if(s)s.setAttribute("data-stale",on?"true":"false");}
function apply(d){
var b=q("[data-wallet-balance]");if(b)b.textContent=money(d.balanceCents);
var p=q("[data-wallet-points]");if(p)p.textContent=String(d.points);
var a=q("[data-wallet-asof]");if(a){a.textContent=fmt.format(new Date(d.asOf));a.setAttribute("datetime",d.asOf);}
var h=q("[data-wallet-history]");
if(h){
if(d.history.length){var ul=el("ul","flex flex-col divide-y divide-border");d.history.forEach(function(e){ul.appendChild(row(e));});h.replaceChildren(ul);}
else h.replaceChildren(el("p","text-sm text-muted","No transactions yet."));
}
stale(false);
}
if(!navigator.onLine){stale(true);return;}
fetch("/api/wallet",{headers:{accept:"application/json"}}).then(function(r){if(!r.ok)throw 0;return r.json();}).then(apply).catch(function(){stale(true);});
})();`;
