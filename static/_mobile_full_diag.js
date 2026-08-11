
(function() {
    console.log('========== ZOOT! Mobile Full Diagnostic ==========');
    
    // 1. ELement check
    var pages = document.getElementById('pages');
    var app = document.querySelector('.app-container');
    var chatList = document.getElementById('page-chat-list');
    
    console.log('1. Element existence:');
    console.log('  pages:', !!pages, '| app-container:', !!app, '| chat-list:', !!chatList);
    
    if (!pages) { console.log('FATAL: #pages not found!'); return; }
    
    // 2. Computed styles for #pages
    var cs = getComputedStyle(pages);
    console.log('2. #pages computed styles:');
    ['display','height','width','flex','flexGrow','flexShrink','flexBasis','overflow','position','visibility','opacity','minHeight','maxHeight'].forEach(function(p) {
        console.log('  ' + p + ': ' + cs[p]);
    });
    
    // 3. Parent chain
    console.log('3. Parent chain:');
    var el = pages;
    var chain = [];
    while (el && el !== document.body) {
        el = el.parentElement;
        if (!el) break;
        var cs2 = getComputedStyle(el);
        chain.push(el.tagName + (el.id ? '#'+el.id : '') + (el.className ? '.'+el.className.split(' ')[0] : '') + ' display=' + cs2.display + ' height=' + cs2.height + ' position=' + cs2.position + ' overflow=' + cs2.overflow);
    }
    chain.forEach(function(c, i) { console.log('  ' + i + ': ' + c); });
    
    // 4. App-container computed styles
    if (app) {
        var acs = getComputedStyle(app);
        console.log('4. .app-container computed styles:');
        ['display','height','flexDirection','overflow','position','top','bottom'].forEach(function(p) {
            console.log('  ' + p + ': ' + acs[p]);
        });
    }
    
    // 5. Check for any element with style that covers the screen
    console.log('5. Elements with high z-index or fixed position covering viewport:');
    var all = document.querySelectorAll('.app-container > *');
    for (var i = 0; i < all.length; i++) {
        var s = getComputedStyle(all[i]);
        if (s.position === 'fixed' || s.position === 'absolute' || parseFloat(s.zIndex) > 5) {
            console.log('  ' + (all[i].id || all[i].className || all[i].tagName) + ' pos=' + s.position + ' zIndex=' + s.zIndex + ' display=' + s.display + ' w=' + s.width + ' h=' + s.height);
        }
    }
    
    // 6. Check sibling elements in flex flow
    console.log('6. All direct children of .app-container (flex items):');
    if (app) {
        var children = app.children;
        for (var i = 0; i < children.length; i++) {
            var c = children[i];
            var cs3 = getComputedStyle(c);
            if (cs3.display !== 'none') {
                console.log('  [' + i + '] ' + (c.id || c.className || c.tagName) + ' display=' + cs3.display + ' h=' + cs3.height + ' flex=' + cs3.flex);
            }
        }
    }
    
    // 7. Check #page-chat-list visibility
    if (chatList) {
        var clcs = getComputedStyle(chatList);
        console.log('7. #page-chat-list: display=' + clcs.display + ' h=' + clcs.height + ' visibility=' + clcs.visibility);
    }
    
    // 8. CSS rule check
    console.log('8. All #pages CSS rules in all stylesheets:');
    var sheets = document.styleSheets;
    for (var i = 0; i < sheets.length; i++) {
        try {
            var rules = sheets[i].cssRules || sheets[i].rules;
            for (var j = 0; j < rules.length; j++) {
                if (rules[j].selectorText && rules[j].selectorText.indexOf('#pages') >= 0) {
                    console.log('  Sheet ' + i + ' rule ' + j + ': ' + rules[j].selectorText + ' => ' + rules[j].style.cssText);
                }
            }
        } catch(e) { console.log('  Sheet ' + i + ' inaccessible: ' + e.message); }
    }
    
    // 9. Check if there's inline style
    console.log('9. Inline style on #pages:', pages.getAttribute('style'));
    
    // 10. Check for JS errors
    console.log('10. window.onerror check - listen for errors');
    var oldOe = window.onerror;
    window.onerror = function(m, s, l, c, e) {
        console.log('  ERROR: ' + m + ' at ' + s + ':' + l + ':' + c);
        if (oldOe) oldOe.apply(this, arguments);
    };
    
    console.log('========== Diagnostic Complete ==========');
})();
