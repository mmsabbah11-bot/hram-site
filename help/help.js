/* © הרם הנדסה ותחבורה בע״מ, מוחמד סבאח. כל הזכויות שמורות. */
(function(){var q=document.getElementById('fq');if(!q)return;var items=[].slice.call(document.querySelectorAll('.qa')),chips=[].slice.call(document.querySelectorAll('.chip')),cat='',no=document.getElementById('noq');
function run(){var t=q.value.trim().toLowerCase(),n=0;items.forEach(function(d){var ok=(!cat||d.dataset.c===cat)&&(!t||d.textContent.toLowerCase().indexOf(t)>-1);d.hidden=!ok;if(ok)n++;if(t&&ok)d.open=true;});no.hidden=n>0;}
q.addEventListener('input',run);chips.forEach(function(c){c.addEventListener('click',function(){chips.forEach(function(x){x.classList.remove('on')});c.classList.add('on');cat=c.dataset.c;run();});});})();
