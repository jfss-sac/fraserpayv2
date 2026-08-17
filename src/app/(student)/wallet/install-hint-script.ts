export const IOS_INSTALL_HINT_STORAGE_KEY = "fraserpay:ios-install-hint-dismissed";

export const IOS_INSTALL_HINT_SCRIPT = `(function(){
var hint=document.querySelector("[data-ios-install-hint]");
if(!hint)return;
var ua=navigator.userAgent||"";
var isIOS=/iPad|iPhone|iPod/.test(ua)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
var standalone=navigator.standalone===true;
if(window.matchMedia)standalone=standalone||window.matchMedia("(display-mode: standalone)").matches;
if(!isIOS||standalone)return;
var store=null;
try{store=window.localStorage;}catch(_){ }
var dismissed=false;
try{dismissed=store!==null&&store.getItem("${IOS_INSTALL_HINT_STORAGE_KEY}")==="true";}catch(_){ }
if(dismissed)return;
hint.removeAttribute("hidden");
var dismiss=hint.querySelector("[data-ios-install-dismiss]");
if(dismiss)dismiss.addEventListener("click",function(){
hint.setAttribute("hidden","");
try{if(store)store.setItem("${IOS_INSTALL_HINT_STORAGE_KEY}","true");}catch(_){ }
});
})();`;
