(function(){
  console.log("=== ZOOT Mobile Root Diagnostic ===");
  var p=document.getElementById("pages"), a=document.querySelector(".app-container");
  if(!p||!a){console.log("FATAL: pages="+!!p+" app="+!!a);return}
  var cs=getComputedStyle(p);
  console.log("#pages:",JSON.stringify({d:cs.display,h:cs.height,w:cs.width,flex:cs.flex,fg:cs.flexGrow,fs:cs.flexShrink,fb:cs.flexBasis,p:cs.position,ov:cs.overflow,mh:cs.minHeight,bs:cs.boxSizing}));
  var acs=getComputedStyle(a);
  console.log("app:",JSON.stringify({d:acs.display,h:acs.height,fd:acs.flexDirection,p:acs.position,t:acs.top,b:acs.bottom}));
  console.log("--- children ---");
  for(var i=0;i<a.children.length;i++){
    var c=a.children[i],s=getComputedStyle(c);
    if(s.display!=="none")console.log(i+":"+(c.id||c.className||c.tagName)+" h="+s.height+" flex="+s.flex+" pos="+s.position+" z="+s.zIndex);
  }
  console.log("--- CSS rules ---");
  try{
    for(var si=0;si<document.styleSheets.length;si++){
      var rules=document.styleSheets[si].cssRules||document.styleSheets[si].rules;
      for(var j=0;j<rules.length;j++){
        var r=rules[j];
        if(r.selectorText&&r.selectorText.indexOf("#pages")>=0)console.log("S"+si+"R"+j+":"+r.selectorText+"=>"+r.style.cssText);
      }
    }
  }catch(e){console.log("CSSerr:"+e.message)}
  console.log("inline:"+p.getAttribute("style"));
  p.style.height=a.offsetHeight+"px";p.style.flex="1 1 0%";
  console.log("fix: offsetH="+p.offsetHeight+" scrollH="+p.scrollHeight);
  console.log("=== END ===");
})();