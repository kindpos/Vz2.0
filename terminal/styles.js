// Global shared CSS injected once at import time.
// Import as a side-effect: import './styles.js';

(function() {
  if (document.getElementById('kp-shared-styles')) return;
  var s = document.createElement('style');
  s.id = 'kp-shared-styles';
  s.textContent = [
    '.co-scroll::-webkit-scrollbar { display: none }',
  ].join('\n');
  document.head.appendChild(s);
})();
